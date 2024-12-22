import * as fs from "fs";
import logger from "../logger";
import {
  isHybris,
  getIssueID,
  linkIssue,
  saveScreenshots,
} from "./jira-helpers";
import {
  getTestCaseTemplateJiraID,
  updateTestCaseStatus,
} from "./jira-test-case-template";
import {
  addAttachmentsToTC,
  createTCsInTp,
  getTestCaseKey,
  updateTestCaseEnvironment,
  updateTestCaseMarket,
  updateTestCaseSteps,
  updateTestCaseLabels,
} from "./jira-test-case";
import { getTestPlanKey } from "./jira-test-plan";
import { parseStepsFromResultFile } from "./cucumber-helpers";
import { pathToWriteLogFile, pathToReadCucumberResultsDirectory } from "./jira-consts";
import { ParsedScenarioResultsData } from "../../interfaces/jira/parsed-scenario-results-data";
import { isIntegrationTestsEnabled, isTestPlanProvided } from "./cucumber-helpers";

(async () => {
  logger.info(
    `Testflo integration log file in: ${pathToWriteLogFile}`,
    pathToWriteLogFile,
  );

  // read all cucumber result file names
  const cucumberResultFileNames = fs.readdirSync(pathToReadCucumberResultsDirectory);
  logger.info(
    `Following result files found: ${cucumberResultFileNames.toString()}`,
    pathToWriteLogFile,
  );
  try {
    const testPlanKey = await getTestPlanKey();

    for (const fileName of cucumberResultFileNames) {
      const fileData = fs.readFileSync(
        `${pathToReadCucumberResultsDirectory}/${fileName}`,
        "utf8",
      );

      for (const parsedStepsData of parseStepsFromResultFile(fileData)) {
        createJiraTickets(parsedStepsData, testPlanKey);
      }
    }
  } catch (error) {
    logger.error(`Error when ${error}`, pathToWriteLogFile);
  }
})();

async function createJiraTickets(
  scenarioData: ParsedScenarioResultsData,
  testPlanKey: string,
) {
  if (!isIntegrationTestsEnabled()) saveScreenshots(scenarioData);

  const testCaseKey = await getUsedTestCaseKey(testPlanKey, scenarioData);
  // add market to Test Case
  await updateTestCaseMarket(testCaseKey);
  // add env to Test Case
  await updateTestCaseEnvironment(testCaseKey);
  // add Hybris label to Test Case
  if (isHybris()) await updateTestCaseLabels(testCaseKey);
  // status extract and pass here
  await updateTestCaseStatus(testCaseKey, scenarioData);
  const testCaseID = await getIssueID(testCaseKey);
  if (testCaseID) {
    // add screenshots for all TC steps if exists, if not - just update step statuses
    let screenshotTable;
    if (scenarioData.screenShots.length > 0)
      screenshotTable = await addAttachmentsToTC(testCaseKey, scenarioData);
    await updateTestCaseSteps(scenarioData, testCaseID, testCaseKey, screenshotTable);
  } else {
    logger.error(`No testCaseID for ${testCaseKey}`, pathToWriteLogFile);
  }
}
async function getUsedTestCaseKey(
  testPlanKey: string,
  scenarioData: ParsedScenarioResultsData,
) {
  if (isTestPlanProvided()) {
    return await getTestCaseKey(testPlanKey, scenarioData);
  }
  const testCaseTemplateKey = await getTestCaseTemplateJiraID(scenarioData);
  const testCaseKey = await createTCsInTp(testPlanKey, testCaseTemplateKey);
  for (const manualTctId of scenarioData.manualTcts) {
    await linkIssue(testCaseKey, manualTctId, "Relates");
  }

  return testCaseKey;
}
