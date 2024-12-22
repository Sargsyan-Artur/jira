import * as fs from "fs";
import logger from "../logger";
import {
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
} from "./jira-test-case";
import { getTestPlanKey } from "./jira-test-plan";
import { parseStepsFromFeatureFile } from "./cucumber-helpers";
import { pathToWriteLogFile, pathToReadCucumberResultsDirectory } from "./jira-consts";
import envHandler from "utils/envHandler";
import { ParsedFeatureResultsData } from "../../interfaces/jira/parsed-feature-data";
import { updateTestCaseSteps } from "./jira-test-case";

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
// parse and save each result file
(async () => {
  try {
    const testPlanKey = await getTestPlanKey();

    for (const fileName of cucumberResultFileNames) {
      const fileData = fs.readFileSync(
        `${pathToReadCucumberResultsDirectory}/${fileName}`,
        "utf8",
      );
      for (const parsedData of parseStepsFromFeatureFile(fileData)) {
        await createJiraTicket(parsedData, testPlanKey);
      }
    }
  } catch (error) {
    logger.error(`Error when ${error}`, pathToWriteLogFile);
  }
})();

async function createJiraTicket(
  scenarioData: ParsedFeatureResultsData,
  testPlanKey: string,
) {
  saveScreenshots(scenarioData);

  let testCaseKey;
  if (envHandler.getVariable("JIRA_TEST_PLAN_KEY")) {
    testCaseKey = await getTestCaseKey(testPlanKey, scenarioData);
  } else {
    const testCaseTemplateKey = await getTestCaseTemplateJiraID(scenarioData);
    testCaseKey = await createTCsInTp(testPlanKey, testCaseTemplateKey);
    for (const manualTctId of scenarioData.manualTcts) {
      await linkIssue(testCaseKey, manualTctId, "Relates");
    }
  }

  // add market to Test Case
  await updateTestCaseMarket(testCaseKey);
  // add Environment to Test Case
  await updateTestCaseEnvironment(testCaseKey);
  // status extract and pass here
  await updateTestCaseStatus(testCaseKey, scenarioData);
  const testCaseID = await getIssueID(testCaseKey);
  if (testCaseID) {
    // add screenshots for all TC steps if exists, if not - just update step statuses
    let screenshotTable;
    if (scenarioData.screenShots !== undefined)
      screenshotTable = await addAttachmentsToTC(testCaseKey, scenarioData);
    await updateTestCaseSteps(scenarioData, testCaseID, testCaseKey, screenshotTable);
  } else {
    logger.error(`No testCaseID for ${testCaseKey}`, pathToWriteLogFile);
  }
}
