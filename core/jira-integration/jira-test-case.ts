/* eslint-disable @typescript-eslint/no-explicit-any */
import logger from "../logger";
import { pathToWriteLogFile } from "./jira-consts";
import {
  addTestCaseTemplatesToExistingTestPlans,
  getTestCaseTemplateJiraID,
} from "./jira-test-case-template";
import {
  CustomFieldIDs,
  jira,
  resolvedMarketName,
  projectIssueKeys,
  addAttachment,
  linkIssue,
  isReev,
  defineEnvironment,
  resolvedEnvironmentName,
  generateScreenshotsPaths,
  isJiraBugEnabled,
  didScenarioFailed,
} from "./jira-helpers";
import { defineLabels } from "./cucumber-helpers";
import { findIssues } from "./jira-query";
import { updateStepsStatusAndAttachment } from "./jira-step";
import { getBugJiraID } from "./jira-bug";
import { TestCaseTemplatesLinkedToTestPlansRequest } from "interfaces/jira/test-case-templates-linked-to-test-plans-request";
import { ParsedScenarioResultsData } from "../../interfaces/jira/parsed-scenario-results-data";
import { TestPlanSubtask } from "../../interfaces/jira/test-plan-subtask";
import { AttachmentResponse } from "interfaces/jira/attachment-response";
import { JiraQuery } from "interfaces/jira/jira-query";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";

export const createTCsInTp = async (
  testPlanKey: string,
  testCaseTemplateKey: string,
  retryCounter = 0,
): Promise<string> => {
  if (retryCounter > 5) {
    logger.warn(
      `Too many attempts of creating Test Case for template key: ${testCaseTemplateKey}. Continuing...`,
      pathToWriteLogFile,
    );
    return;
  }
  const requestData: TestCaseTemplatesLinkedToTestPlansRequest = {
    testPlanKeys: [testPlanKey],
    testCaseTemplateKeys: [testCaseTemplateKey],
    async: false,
  };

  logger.info(`Test Case request: ${JSON.stringify(requestData)}`, pathToWriteLogFile);
  try {
    const response = await addTestCaseTemplatesToExistingTestPlans(requestData);
    logger.info(
      `Test Case Template Key is ${testCaseTemplateKey} and project = ${projectIssueKeys().testCaseTemplate.toString()}, response for it is:
      ${JSON.stringify(response)}`,
      pathToWriteLogFile,
    );
    return response.testPlans[0].testCases[0].key;
  } catch (error) {
    logger.error(
      `Caught error for ${testCaseTemplateKey}, ERROR: ${error}`,
      pathToWriteLogFile,
    );
    const foundTCinTP = await findTCinTP(testCaseTemplateKey);

    if (foundTCinTP) {
      logger.info(
        `Test Case ${foundTCinTP} successfully added to Test Plan: ${testPlanKey}`,
      );
      return foundTCinTP;
    }
    logger.warn(
      `Error when creating Test Cases: ${error} for ${testCaseTemplateKey} at: ${error.stack}. Retrying... ${retryCounter}`,
      pathToWriteLogFile,
    );
    return createTCsInTp(testPlanKey, testCaseTemplateKey, ++retryCounter);
  }
};

export const findTCinTP = async (testCaseTemplateKey: string): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const jql = `project = ${projectIssueKeys().testCase.toString()} AND type = 'Test Case' AND status = OPEN and "TC Template"~ '${testCaseTemplateKey}' AND reporter = s-test-automation Order BY createdDate DESC`;

  const query: JiraQuery = {
    jql: jql,
    optional: {
      fields: ["description", "summary"],
      maxResults: 10,
    },
  };
  const queryResponse = await findIssues(query);
  const existingTctNumber = queryResponse.issues[0]?.key;

  const loggerMessage = existingTctNumber
    ? `Found existing Test Case for template: ${existingTctNumber}`
    : `Do not found existing Test Case for query ${jql}`;
  logger.info(loggerMessage, pathToWriteLogFile);

  return existingTctNumber;
};

export const getTestCaseKey = async (
  testPlanKey: string,
  parsedStepsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> => {
  const response = await jira.getIssue(testPlanKey, "subtasks");

  const subtasks = <Array<TestPlanSubtask>>response.fields.subtasks;
  for (const issue of subtasks) {
    if (issue.fields.summary.endsWith(parsedStepsData.name)) return issue.key;
  }
  logger.warn(
    "Not found correct test case to match - creating new one",
    pathToWriteLogFile,
  );
  const testCaseTemplateKey = await getTestCaseTemplateJiraID(parsedStepsData);
  return await createTCsInTp(testPlanKey, testCaseTemplateKey);
};

export const updateTestCaseMarket = async (testCaseKey: string): Promise<string> => {
  const body = {
    fields: { [CustomFieldIDs.Markets]: [{ value: resolvedMarketName() }] },
  };
  return await jira.updateIssue(testCaseKey, body, "");
};

export const updateTestCaseEnvironment = async (
  testCaseKey: string,
): Promise<string> => {
  const body = {
    fields: {
      [isReev() ? CustomFieldIDs.ReevEnvironment : CustomFieldIDs.Environment]:
        defineEnvironment(resolvedEnvironmentName()),
    },
  };
  return await jira.updateIssue(testCaseKey, body, "");
};

export const updateTestCaseLabels = async (testCaseKey: string): Promise<string> => {
  const body = {
    fields: { [CustomFieldIDs.Labels]: defineLabels("tc") },
  };
  return await jira.updateIssue(testCaseKey, body, "");
};

export async function updateTestCaseSteps(
  scenarioData: ParsedScenarioResultsData | ParsedFeatureResultsData,
  testCaseID: string,
  testCaseKey: string,
  screenshotTable?: Array<AttachmentResponse>,
): Promise<void> {
  let bugNumber: string;
  if (isJiraBugEnabled() && didScenarioFailed(scenarioData)) {
    bugNumber = await createBugForTestCase(scenarioData, testCaseKey);
  }
  await updateStepsStatusAndAttachment({
    testCaseId: testCaseID,
    resultsData: scenarioData,
    bugNumber,
    screenshotTable,
  });
}

export const createBugForTestCase = async (
  scenarioData: ParsedScenarioResultsData | ParsedFeatureResultsData,
  testCaseKey: string,
) => {
  let bugNumber: string;
  try {
    bugNumber = await getBugJiraID(scenarioData as ParsedScenarioResultsData);
    await linkIssue(bugNumber, testCaseKey, "Relates");
  } catch (error) {
    logger.error(`Error -${error} when creating bug for ${testCaseKey}. Continuing...`);
  }
  return bugNumber;
};

export async function addAttachmentsToTC(
  testCaseKey: string,
  scenarioData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<any> {
  const screenshotTable = [];
  const screenshotPaths = generateScreenshotsPaths(scenarioData);
  const screenshots = scenarioData.screenShots.filter(Boolean);
  for (const index in screenshots) {
    const response = await addAttachment(testCaseKey, screenshotPaths[index]);
    screenshotTable.push(response[0]);
  }
  return screenshotTable;
}
