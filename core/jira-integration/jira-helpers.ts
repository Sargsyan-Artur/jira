// eslint-disable-next-line @typescript-eslint/no-var-requires
const JiraApi = require("jira-client"); //  legacy reasons https://github.com/jira-node/node-jira-client/issues/253
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as countries from "i18n-iso-countries"; // legacy reasons
import logger from "../logger";
import { pathToWriteLogFile, pathToWriteParsedResultsData } from "./jira-consts";
import { Field } from "interfaces/jira/field";
import { ReevField } from "interfaces/jira/reev-field";
import environmentHandler from "../envHandler";
import { AttachmentResponse } from "interfaces/jira/attachment-response";
import { JiraSprint } from "interfaces/jira/jira-sprint";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";
import { findFailedSteps } from "./jira-step";
import path from "path";
import { ParsedScenarioResultsData } from "interfaces/jira/parsed-scenario-results-data";
import { saveFileUnderPath } from "../file-helpers";
import { CucumberStepStatuses } from "./cucumber-helpers";

dotenv.config(); // assign environment variables defined in .env file

export enum EpicMarkets {
  SK = "DCE20IMP-28270",
}
export enum IssueTypes {
  TestPlan = "Test Plan",
  TestCaseTemplate = "Test Case Template",
  BugReport = "Bug",
}
export enum CustomFieldIDs {
  TestLevel = "customfield_18813",
  TestExecutionLevel = "customfield_18813",
  TestExecutionType = "customfield_18814",
  TestKindsType = "customfield_18815",
  TestSteps = "customfield_18001",
  TestScript = "customfield_18803",
  TCTemplate = "customfield_10103",
  Markets = "customfield_12508",
  Environment = "customfield_17911",
  Requirement = "customfield_10100",
  ScrumTeam = "customfield_18002",
  EpicLink = "customfield_10002",
  Components = "components",
  ReevEnvironment = "customfield_13600",
  Sprint = "customfield_10001",
  TestType = "customfield_27701",
  Severity = "customfield_31516",
  IdentifiedBy = "customfield_30103",
  Labels = "labels",
  StoryPoints = "customfield_10006",
}
export enum ReevSeverity {
  Minor = "35405",
  Moderate = "35404",
  Major = "35403",
  Critical = "35402",
}

export enum IdentifiedBy {
  End2endLevelTestAutomation = "33427",
  ProductLevelTestAutomation = "33428",
}

export enum TestKinds {
  Regression = "Regression",
  Acceptance = "Acceptance",
  Functional = "Functional",
  GUI = "GUI",
}
export enum TestExecutionLevels {
  Component = "20295",
  Integration = "20296",
  E2E = "20297",
}
export enum ReevTestKinds {
  Acceptance = "20302",
  Functional = "20303",
  Regression = "20304",
  GUI = "20305",
  Compatibility = "20306",
  Performance = "20307",
  Sanity = "31779",
}
export enum TransitionIDs {
  Test = "11",
  Pass = "21",
  Fail = "31",
  Inactive = "11",
}
export enum TCStepStatuses {
  Pass = "Pass",
  Fail = "Fail",
  ToDo = "To do",
}

const serverHost = "jira.pmidce.com";

export enum Projects {
  Default = "Default",
  RollIn = "RollIn",
  SIT = "SIT",
  GAM = "GAM",
  DCE20DES = "DCE20DES",
  DCE20IMP = "DCE20IMP", // Playground project for testing integration only
  RCGC = "RCGC",
  RB2BCC = "RB2BCC",
  ORCH = "Orchestration",
  EXPC = "EXPC",
  MKTC = "MKTC",
  MULE = "MULE",
  SEGN = "SEGN",
  REEVE2E = "REEV-E2E",
  HYBRIS = "DCE20HOME",
}

export const projectIssueKeys = (): {
  testPlan: string;
  testCaseTemplate: string;
  testCase: string;
  bug: string;
  scrumTeam: string;
  scrumBoard?: number;
  identifyBy?: IdentifiedBy;
} => {
  const defaultProjectsKeys = {
    testPlan: "DCE20HOME",
    testCaseTemplate: "DCE20DES",
    testCase: "DCE20HOME",
    bug: "DCE20HOME",
    scrumTeam: "Integration Testing",
  };

  switch (environmentHandler.getVariable("PROJECTS")) {
    case Projects.Default:
    case Projects.SIT:
      return defaultProjectsKeys;
    case Projects.DCE20DES:
      return {
        testPlan: "DCE20HOME",
        testCaseTemplate: "DCE20DES",
        testCase: "DCE20HOME",
        bug: "DCE20TAF",
        scrumTeam: "QA Domain",
      };
    case Projects.DCE20IMP:
      return {
        testPlan: "DCE20IMP",
        testCaseTemplate: "DCE20IMP",
        testCase: "DCE20IMP",
        bug: "DCE20IMP",
        scrumTeam: "QA Domain",
      };
    case Projects.RollIn:
      return {
        testPlan: "DIGIMP",
        testCaseTemplate: "DIGIMPTF",
        testCase: "DIGIMPTF",
        bug: "DIGIMPTF",
        scrumTeam: "Roll out",
      };
    case Projects.GAM:
      return {
        testPlan: "DCE20HOME",
        testCaseTemplate: "DCE20HOME",
        testCase: "DCE20HOME",
        bug: "DCE20HOME",
        scrumTeam: "GAM RMP",
      };
    case Projects.RCGC:
    case Projects.ORCH:
    case Projects.EXPC:
    case Projects.MULE:
    case Projects.RB2BCC:
    case Projects.MKTC:
    case Projects.SEGN:
      return {
        testPlan: "RTS",
        testCaseTemplate: "RTS",
        testCase: "RTS",
        bug: "RTS",
        scrumTeam: "29707",
        identifyBy: IdentifiedBy.ProductLevelTestAutomation,
      };
    case Projects.REEVE2E:
      return {
        testPlan: "RTS",
        testCaseTemplate: "RTS",
        testCase: "RTS",
        bug: "RTS",
        scrumTeam: "29706",
        scrumBoard: 2716,
        identifyBy: IdentifiedBy.End2endLevelTestAutomation,
      };
    case Projects.HYBRIS:
      return {
        testPlan: "DCE20HOME",
        testCaseTemplate: "DCE20DES",
        testCase: "DCE20HOME",
        bug: "DCE20HOME",
        scrumTeam: "Integration Testing",
      };
    default:
      logger.warn(
        `Value of environment variable PROJECTS: ${environmentHandler.getVariable(
          "PROJECTS",
        )} is not supported. Using default project keys: ${JSON.stringify(
          defaultProjectsKeys,
        )}`,
        pathToWriteLogFile,
      );
      return defaultProjectsKeys;
  }
};

const oAuth = {
  consumer_key: "TAF",
  consumer_secret: environmentHandler.getVariable("PRIVATE_KEY"),
  access_token: environmentHandler.getVariable("JIRA_ACCESS_TOKEN"),
  access_token_secret: environmentHandler.getVariable("JIRA_ACCESS_TOKEN_SECRET"),
};

export const resolvedMarketName = (): string => {
  return countries.getNames("en")[
    environmentHandler.getVariable("MARKET").toUpperCase()
  ];
};

export const isReev = (): boolean => {
  return (
    environmentHandler.getVariable("PROJECTS") === Projects.RCGC ||
    environmentHandler.getVariable("PROJECTS") === Projects.RB2BCC ||
    environmentHandler.getVariable("PROJECTS") === Projects.ORCH ||
    environmentHandler.getVariable("PROJECTS") === Projects.MULE ||
    environmentHandler.getVariable("PROJECTS") === Projects.EXPC ||
    environmentHandler.getVariable("PROJECTS") === Projects.MKTC ||
    environmentHandler.getVariable("PROJECTS") === Projects.SEGN ||
    environmentHandler.getVariable("PROJECTS") === Projects.REEVE2E
  );
};

export const isHybris = (): boolean => {
  return environmentHandler.getVariable("PROJECTS") === Projects.HYBRIS;
};

export const isJiraBugEnabled = (): boolean =>
  environmentHandler.getVariable("JIRA_BUG_ENABLED") === "false" ? false : true;

export const didScenarioFailed = (
  scenarioData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): boolean => scenarioData.testCaseStatus === CucumberStepStatuses.Failed;

export const resolvedEnvironmentName = (): string => {
  switch (environmentHandler.getVariable("ENVIRONMENT")) {
    case "prod":
      return "PROD";
    case "pp":
      return "PRE PROD";
    case "qa":
      return "QA";
    case "ppd":
      return "PPD";
    case "stg":
      return "STG";
    case "hotfix":
      return "HOTFIX";
    case "dev":
      return "DEV";
    default:
      logger.warn(
        `Provided ENVIRONMENT value: ${environmentHandler.getVariable(
          "ENVIRONMENT",
        )} is not match to standard environment, returning env variable`,
        pathToWriteLogFile,
      );
      return environmentHandler.getVariable("ENVIRONMENT");
  }
};

export function defineCurrentEnvironment(environment: string) {
  return {
    int: "26501",
    qa: "26502",
    stg: "26503",
    pp: "26504",
    ppd: "26504",
    prod: "26505",
  }[environment.toLowerCase()];
}

export const defineEnvironment = (environmentDefine: string): Field[] | ReevField => {
  if (!isReev())
    return [
      {
        value: environmentDefine, // single value array is supported as there is no possibility to test on different environments at the same time
      },
    ];
  const definedEnvironment = defineCurrentEnvironment(environmentDefine);
  return {
    id: definedEnvironment ?? "-1",
  };
};

export const getLastSprint = async (): Promise<JiraSprint> => {
  return jira.getLastSprintForRapidView(projectIssueKeys().scrumBoard);
};

export const defineScrumTeam = (): Field | ReevField => {
  if (!isReev())
    return {
      value: projectIssueKeys().scrumTeam, // single value array is supported as there is no possibility to test on different environments at the same time
    };
  return {
    id: projectIssueKeys().scrumTeam,
  };
};

export const initJiraAPI = (): typeof JiraApi => {
  return new JiraApi({
    protocol: "https",
    host: serverHost,
    apiVersion: "2",
    strictSSL: true,
    oauth: oAuth,
  });
};

export class JiraIssue {
  constructor(
    projectKey: string,
    summary: string,
    description: string,
    labels?: string[],
  ) {
    this.fields = {
      project: { key: projectKey },
      summary: summary,
      description: description,
    };
    if (environmentHandler.getVariable("JIRA_EPIC_KEY"))
      this.fields[CustomFieldIDs.EpicLink] = `${environmentHandler.getVariable(
        "JIRA_EPIC_KEY",
      )}`;

    if (labels) {
      this.fields.labels = labels;
    }
  }

  fields: {
    project: { key: string };
    summary: string;
    description: string;
    labels?: string[];
    [CustomFieldIDs.EpicLink]?: string;
  };
}

export const linkIssue = async (
  inwardKey: string,
  outwardKey: string,
  linkType: "Relates" | "Parenthood",
): Promise<string> => {
  const request = {
    type: {
      name: linkType,
    },
    inwardIssue: {
      key: inwardKey,
    },
    outwardIssue: {
      key: outwardKey,
    },
  };
  logger.info(
    `Linking ${linkType} issues request:
    ${JSON.stringify(request)}`,
    pathToWriteLogFile,
  );
  try {
    const response = await jira.issueLink(request);

    return response;
  } catch (error) {
    logger.error(
      `Error when linking ${linkType} issues with keys: "${inwardKey}" and "${outwardKey}". ${error} Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const getIssueID = async (
  issueKey: string,
  retryCounter = 1,
): Promise<string> => {
  if (retryCounter > 3) {
    logger.warn(
      `Too many attempts of getting Issue ID for key: ${issueKey}. Continuing...`,
      pathToWriteLogFile,
    );
    return;
  }
  try {
    const response = await jira.findIssue(issueKey);
    logger.info(
      `Issue found by ID: ${JSON.stringify(response.id)}`,
      pathToWriteLogFile,
    );
    return response.id;
  } catch (error) {
    logger.error(
      `Error when getting Issue ID: ${error} at: ${error.stack}. Retrying... ${retryCounter}`,
      pathToWriteLogFile,
    );
    return getIssueID(issueKey, ++retryCounter);
  }
};

export const addAttachment = async (
  issueKey: string,
  imagePath: string,
): Promise<AttachmentResponse[]> => {
  logger.info(`Adding attachment to issue with key: ${issueKey}`);
  try {
    const readStream = fs.createReadStream(imagePath);
    const response = await jira.addAttachmentOnIssue(issueKey, readStream);
    logger.info(
      `Add Attachment response: ${JSON.stringify(response)}`,
      pathToWriteLogFile,
    );
    return response;
  } catch (error) {
    logger.error(
      `Error when Adding Attachment: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const generateScreenshotsPaths = (
  scenarioData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): string[] => {
  const failedSteps = findFailedSteps(scenarioData);
  const screenshots = scenarioData.screenShots.filter(Boolean);
  const screenshotsOnFail = screenshots.length === failedSteps.length;
  const paths: string[] = [];
  for (const index in screenshots) {
    const screenshotIndex = screenshotsOnFail ? failedSteps[index] : index;
    paths.push(
      path.join(
        `${pathToWriteParsedResultsData}/${
          scenarioData.stepDescriptions.filter((item) => !!item)[screenshotIndex]
        }.png`,
      ),
    );
  }
  return paths;
};

export function saveScreenshots(scenarioData: ParsedScenarioResultsData) {
  const screenshotPaths = generateScreenshotsPaths(scenarioData);
  const screenshots = scenarioData.screenShots.filter(Boolean);
  for (const index in screenshots) {
    saveFileUnderPath(
      screenshotPaths[index],
      Buffer.from(screenshots[index], "base64"),
    );
  }
}

// Initialize
export const jira = initJiraAPI();
