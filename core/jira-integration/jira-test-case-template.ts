import { Step, FeatureStep } from "./jira-step";
import {
  CustomFieldIDs,
  JiraIssue,
  IssueTypes,
  jira,
  resolvedEnvironmentName,
  resolvedMarketName,
  projectIssueKeys,
  linkIssue,
  TransitionIDs,
  defineEnvironment,
  defineScrumTeam,
  isReev,
  isHybris,
} from "./jira-helpers";
import logger from "../logger";
import {
  CucumberStepStatuses,
  defineLabels,
  defineTestKinds,
  defineTestLevel,
} from "./cucumber-helpers";
import { pathToWriteLogFile } from "./jira-consts";
import { findIssues } from "./jira-query";
import { isIntegrationTestsEnabled } from "./cucumber-helpers";
import { TestCaseTemplatesLinkedToTestPlansRequest } from "interfaces/jira/test-case-templates-linked-to-test-plans-request";
import { TestCaseTemplatesLinkedToTestPlansResponse } from "../../interfaces/jira/test-case-templates-linked-to-test-plans-response";
import { Field } from "../../interfaces/jira/field";
import { ReevField } from "interfaces/jira/reev-field";
import { ParsedScenarioResultsData } from "../../interfaces/jira/parsed-scenario-results-data";
import { JiraIssueResponse } from "../../interfaces/jira/jira-issue-response";
import { JiraQueryResponse } from "../../interfaces/jira/jira-query-response";
import { JiraQuery } from "interfaces/jira/jira-query";
import { JiraSteps } from "../../interfaces/jira/jira-steps";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";
import { Component } from "interfaces/jira/component";
import { reevTags } from "./reev-consts";
import { waitForTimeout } from "utils/api-request-helpers";

export class TestCaseTemplateFields {
  constructor(
    testLevel: Field | ReevField,
    executionType: string,
    testKinds: Field[] | ReevField[],
    testScript: string,
    environment: string,
    markets: string,
    requirements: string[],
  ) {
    this.fields = {
      [CustomFieldIDs.TestLevel]: testLevel,
      [CustomFieldIDs.TestExecutionType]: {
        value: executionType,
      },
      [CustomFieldIDs.TestKindsType]: testKinds,
      [CustomFieldIDs.TestScript]: testScript,
      [isReev() ? CustomFieldIDs.ReevEnvironment : CustomFieldIDs.Environment]:
        defineEnvironment(environment),
      [CustomFieldIDs.Markets]: [
        {
          value: markets, // single value array is supported as there is no possibility to test on different markets at the same time
        },
      ],
      [CustomFieldIDs.Requirement]: requirements,
    };
  }

  fields: {
    [CustomFieldIDs.TestLevel]: Field | ReevField;
    [CustomFieldIDs.TestExecutionType]: Field;
    [CustomFieldIDs.TestKindsType]: Field[] | ReevField[];
    [CustomFieldIDs.TestScript]: string;
    [CustomFieldIDs.Environment]?: Field[];
    [CustomFieldIDs.ReevEnvironment]?: Field;
    [CustomFieldIDs.Markets]: Field[];

    [CustomFieldIDs.Requirement]?: string[];
  };
}

export class TestCaseTemplate extends JiraIssue {
  constructor(
    projectKey: string,
    summary: string,
    description: string,
    testFields: TestCaseTemplateFields,
  ) {
    super(projectKey, summary, description);
    this.fields.issuetype = { name: IssueTypes.TestCaseTemplate };
    this.fields[CustomFieldIDs.TestLevel] = testFields.fields[CustomFieldIDs.TestLevel];
    this.fields[CustomFieldIDs.TestExecutionType] =
      testFields.fields[CustomFieldIDs.TestExecutionType];
    this.fields[CustomFieldIDs.TestKindsType] =
      testFields.fields[CustomFieldIDs.TestKindsType];
    if (!isReev()) this.fields[CustomFieldIDs.TestType] = { value: "OTHER" };
    this.fields[CustomFieldIDs.TestScript] =
      testFields.fields[CustomFieldIDs.TestScript];
    // this field is not supported on TCT and TC level in DCE20IMP project
    // TODO remove this field form TCT completly
    // this.fields[CustomFieldIDs.Environment] =
    //   testFields.fields[CustomFieldIDs.Environment];
    this.fields[CustomFieldIDs.ScrumTeam] = defineScrumTeam();
    this.fields[CustomFieldIDs.Markets] = testFields.fields[CustomFieldIDs.Markets];
    // see discussion in https://jira.pmidce.com/browse/DCE20TAF-137?focusedCommentId=1253904&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-1253904
    this.fields[CustomFieldIDs.Requirement] =
      testFields.fields[CustomFieldIDs.Requirement];
    const stepsRowsData: Step[] = [];
    this.fields[CustomFieldIDs.TestSteps] = {
      stepsRows: stepsRowsData,
    };
    this.fields[CustomFieldIDs.Labels] = testFields.fields[CustomFieldIDs.Labels];
  }

  fields: {
    project: { key: string };
    summary: string;
    description: string;
    issuetype: { name: IssueTypes };
    [CustomFieldIDs.TestLevel]: Field | ReevField;
    [CustomFieldIDs.TestExecutionType]: Field;
    [CustomFieldIDs.TestKindsType]: Field[] | ReevField[];
    [CustomFieldIDs.TestScript]: string;
    [CustomFieldIDs.TestType]: Field;
    // [CustomFieldIDs.Environment]: Field[];
    [CustomFieldIDs.Markets]: Field[];
    [CustomFieldIDs.TestSteps]: { stepsRows: Step[] | FeatureStep[] };
    [CustomFieldIDs.ScrumTeam]: Field | ReevField;
    [CustomFieldIDs.EpicLink]?: string;
    [CustomFieldIDs.Requirement]?: string[];
    [CustomFieldIDs.Components]?: Component[];
    [CustomFieldIDs.Labels]?: string[];
  };
}

export const addTestCaseTemplatesToExistingTestPlans = async (
  requestData: TestCaseTemplatesLinkedToTestPlansRequest,
): Promise<TestCaseTemplatesLinkedToTestPlansResponse> => {
  return await jira.doRequest(
    jira.makeRequestHeader(
      jira.makeUri({
        pathname: "/add-test-case-templates",
        query: null,
        intermediatePath: "/rest/tms/1.0/testplan",
      }),
      {
        method: "POST",
        followAllRedirects: true,
        body: requestData,
      },
    ),
  );
};

export const resultsDataRequirements = async (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> => {
  if (isIntegrationTestsEnabled() && resultsData.manualTcts.length === 0) {
    return "";
  }
  return `requirements: ${resultsData.requirements}\n`;
};

export const resultsDataManualTcts = async (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> => {
  if (isIntegrationTestsEnabled() && resultsData.manualTcts.length === 0) {
    return "";
  }
  return `relates to: ${resultsData.manualTcts}\n`;
};

export const createNewTestCaseTemplate = async (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<JiraIssueResponse> => {
  const testLevel = defineTestLevel(resultsData.tags);
  const testKinds = defineTestKinds(resultsData.tags);
  const bitbucketBaseUrl =
    "https://bitbucket.pmidce.com/projects/DCE20/repos/dce20-pmi-qa-framework-e2e/browse/";

  const requirements = resultsData.requirements;

  const testFields = new TestCaseTemplateFields(
    testLevel,
    "Automated",
    testKinds,
    `${bitbucketBaseUrl}${resultsData.scriptPath}`,
    resolvedEnvironmentName(),
    resolvedMarketName(),
    requirements,
  );
  const description = isReev()
    ? (resultsData as ParsedFeatureResultsData).description
    : `${await resultsDataManualTcts(resultsData)}
  ${await resultsDataRequirements(resultsData)}
    test script: ${bitbucketBaseUrl}${resultsData.scriptPath}`;

  const tct = new TestCaseTemplate(
    projectIssueKeys().testCaseTemplate,
    resultsData.name.toString(),
    description,
    testFields,
  );

  if (!isReev()) {
    tct.fields[CustomFieldIDs.TestSteps].stepsRows =
      resultsData.fields[CustomFieldIDs.TestSteps].stepsRows; // TODO this should be assigned in constructor
  } else {
    tct.fields[CustomFieldIDs.TestSteps].stepsRows = fillStepsFromFeatureFile(
      resultsData as ParsedFeatureResultsData,
    );
    tct.fields[CustomFieldIDs.TestScript] = resultsData.scriptPath;
  }

  tct.fields[CustomFieldIDs.Components] = [];
  for (const tag of resultsData.tags) {
    if (Object.prototype.hasOwnProperty.call(reevTags, tag))
      tct.fields[CustomFieldIDs.Components].push({ name: reevTags[tag] });
  }
  tct.fields[CustomFieldIDs.TestLevel] = defineTestLevel(resultsData.testLevel);
  if (isHybris()) tct.fields[CustomFieldIDs.Labels] = defineLabels("tct");

  logger.info(
    `Test Case Template request:
    ${JSON.stringify(tct)}`,
    pathToWriteLogFile,
  );
  try {
    const tctResponse = await jira.addNewIssue(tct);
    logger.info(
      `Test Case Template response:
      ${JSON.stringify(tctResponse)}`,
      pathToWriteLogFile,
    );
    for (const manualTctId of resultsData.manualTcts) {
      await linkIssue(tctResponse.key, manualTctId, "Relates");
    }
    return tctResponse;
  } catch (error) {
    logger.error(
      `Error when creating Test Case Template: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const matchTestCaseStatus = (
  parsedStatus: CucumberStepStatuses,
): TransitionIDs => {
  switch (parsedStatus) {
    case CucumberStepStatuses.Passed:
      return TransitionIDs.Pass;
    case CucumberStepStatuses.Failed:
      return TransitionIDs.Fail;
  }
};

export const fillStepsFromFeatureFile = (
  resultsData: ParsedFeatureResultsData,
): FeatureStep[] => {
  const scenarioDataForFeature: FeatureStep[] = [];
  for (const stepName of resultsData.fields[CustomFieldIDs.TestSteps].stepsRows) {
    if (stepName.isGroup === true) {
      scenarioDataForFeature.push(
        new FeatureStep([`${stepName.cells.toString()}`, "", ""], true),
      );
      continue;
    }
    scenarioDataForFeature.push(
      new FeatureStep([`${stepName.cells.toString()}`, "", ""], false),
    );
  }
  return scenarioDataForFeature;
};

export const updateTestCaseStatus = async (
  testCaseKey: string,
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<void> => {
  const transition = {
    transition: { id: matchTestCaseStatus(resultsData.testCaseStatus) },
  };
  logger.info(
    `Test Case Status Update request: ${JSON.stringify(
      transition,
    )} for key ${testCaseKey}`,
    pathToWriteLogFile,
  );
  try {
    await jira.transitionIssue(testCaseKey, {
      transition: { id: TransitionIDs.Test },
    });
    await waitForTimeout(5000);
    logger.info(`\n -> Transition: Test`); // TODO is there any response form this endpoint
    await jira.transitionIssue(testCaseKey, transition);
    logger.info(
      `\n -> Transition for ${testCaseKey}: into status ${resultsData.testCaseStatus}`,
    );
  } catch (error) {
    logger.error(
      `There was issue with updating TC status: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const getTestCaseTemplateJiraID = async (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> => {
  const existingTctNumber = await findTctIfExists(resultsData);

  if (!existingTctNumber || existingTctNumber == undefined)
    // eslint-disable-next-line unicorn/no-await-expression-member
    return (await createNewTestCaseTemplate(resultsData)).key;

  return (await isTctNewest(existingTctNumber, resultsData))
    ? existingTctNumber
    : await upgradeTctVersion(existingTctNumber, resultsData);
};

export async function findTctIfExists(
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> {
  const summary = resultsData.name.toString().replace(/ - /g, " ");
  const jql = `project = ${projectIssueKeys().testCaseTemplate.toString()} AND status = Active AND type = "Test Case Template" AND summary ~ "${summary}" AND reporter = s-test-automation Order BY createdDate DESC`;

  const query: JiraQuery = {
    jql: jql,
    optional: {
      fields: ["description", "summary"],
      maxResults: 10,
    },
  };
  const queryResponse = await findIssues(query);
  const existingTestCase = await findRightTCifExist(queryResponse, resultsData);

  logger.info("queryResponse: " + JSON.stringify(queryResponse), pathToWriteLogFile);

  const loggerMessage = existingTestCase
    ? `Found existing Test Case Template: ${existingTestCase}`
    : `Do not found existing Test Case Template for query ${jql}`;
  logger.info(loggerMessage, pathToWriteLogFile);

  return existingTestCase;
}

export async function findRightTCifExist(
  queryResponse: JiraQueryResponse,
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> {
  logger.info(
    `Searched Test Case Template is: ${resultsData.name.toString()}`,
    pathToWriteLogFile,
  );
  const issue = queryResponse.issues.find(
    (item) =>
      item.fields.summary.toString().trim() === resultsData.name.toString().trim(),
  );
  if (!issue)
    logger.info(
      `Cannot find Test Case I returned: ${issue} for name ${resultsData.name.toString()}`,
      pathToWriteLogFile,
    );

  return issue?.key;
}

export async function isTctNewest(
  existingTctNumber: string,
  executedResultData: ParsedScenarioResultsData | ParsedFeatureResultsData,
  retryCounter = 0,
): Promise<boolean> {
  let existingTct: { fields: JiraSteps };
  try {
    existingTct = await jira.getIssue(existingTctNumber, CustomFieldIDs.TestSteps);
    logger.info(
      `Getting Test Steps for Test Case: ${existingTctNumber}:
      ${JSON.stringify(existingTct)}`,
      pathToWriteLogFile,
    );
  } catch (error) {
    logger.error(
      `Error when creating Steps: ${error} for Test Cases ${existingTctNumber} at: ${error.stack}. Retrying... ${retryCounter}`,
      pathToWriteLogFile,
    );
    return isTctNewest(existingTctNumber, executedResultData, ++retryCounter);
  }

  const existingSteps = existingTct.fields[CustomFieldIDs.TestSteps].stepsRows.map(
    (value) => new Step(value.cells),
  );
  for (const [index, existingStep] of existingSteps.entries()) {
    if (
      !executedResultData.fields.customfield_18001.stepsRows[index].cells.every(
        (ele, index) => ele === existingStep.cells[index],
      )
    )
      return false;
  }
  logger.info(
    `Existing Test Case Template ${existingTctNumber} is actual`,
    pathToWriteLogFile,
  );
  return true;
}

export async function upgradeTctVersion(
  existingTctNumber: string,
  executedResultData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<string> {
  try {
    await jira.transitionIssue(existingTctNumber, {
      transition: { id: TransitionIDs.Inactive },
    });
    logger.info(
      `\n -> Transition: ${existingTctNumber}` + " Inactive",
      pathToWriteLogFile,
    );
  } catch (error) {
    logger.error(
      `There was issue with moving TCT ${existingTctNumber} to Inactive state: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
  const tctKey = (await createNewTestCaseTemplate(executedResultData)).key;

  linkIssue(existingTctNumber, tctKey, "Parenthood");

  return tctKey;
}
