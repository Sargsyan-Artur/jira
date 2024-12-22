/* eslint-disable no-control-regex */
import {
  CustomFieldIDs,
  JiraIssue,
  IssueTypes,
  projectIssueKeys,
  resolvedMarketName,
  resolvedEnvironmentName,
  jira,
  addAttachment,
  Projects,
  defineEnvironment,
  defineScrumTeam,
  isReev,
  getLastSprint,
  ReevSeverity,
  IdentifiedBy,
} from "./jira-helpers";
import { findIssues } from "./jira-query";
import logger from "../logger";
import {
  pathToWriteLogFile,
  pathToWriteParsedResultsData,
  Keywords,
} from "./jira-consts";
import path from "path";
import { isIntegrationTestsEnabled } from "./cucumber-helpers";
import envHandler from "utils/envHandler";
import { Field } from "interfaces/jira/field";
import { ReevField } from "interfaces/jira/reev-field";
import { JiraIssueResponse } from "interfaces/jira/jira-issue-response";
import { ParsedScenarioResultsData } from "interfaces/jira/parsed-scenario-results-data";
import { JiraQuery } from "interfaces/jira/jira-query";
import { findFailedStep } from "./jira-step";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";
import { reevTags } from "./reev-consts";
import { JiraSprint } from "interfaces/jira/jira-sprint";

export class BugReportFields {
  constructor(environment: string, markets: string, component: string[]) {
    // for requirements field see discussion in
    // https://jira.pmidce.com/browse/DCE20TAF-137?focusedCommentId=1253904&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-1253904
    this.fields = {
      [isReev() ? CustomFieldIDs.ReevEnvironment : CustomFieldIDs.Environment]:
        defineEnvironment(environment),
      [CustomFieldIDs.Markets]: [
        {
          value: markets, // single value array is supported as there is no possibility to test on different markets at the same time
        },
      ],
      [CustomFieldIDs.Components]: component.map((item) => {
        return { name: item };
      }),
    };
  }

  fields: {
    [CustomFieldIDs.Environment]?: Field[];
    [CustomFieldIDs.ReevEnvironment]?: Field;
    [CustomFieldIDs.Markets]: Field[];
    [CustomFieldIDs.Components]: { name: string }[];
  };
}
export class BugReport extends JiraIssue {
  constructor(
    projectKey: string,
    summary: string,
    description: string,
    labels: string[],
    fields: BugReportFields,
  ) {
    super(projectKey, summary, description);
    this.fields.issuetype = { name: IssueTypes.BugReport };
    this.fields.labels = labels;
    if (isReev()) {
      this.fields[CustomFieldIDs.ReevEnvironment] =
        fields.fields[CustomFieldIDs.ReevEnvironment];
      this.fields[CustomFieldIDs.Severity] = { id: ReevSeverity.Moderate };
      this.fields[CustomFieldIDs.IdentifiedBy] = { id: projectIssueKeys().identifyBy };
    } else {
      this.fields[CustomFieldIDs.Environment] =
        fields.fields[CustomFieldIDs.Environment];
    }
    this.fields[CustomFieldIDs.Markets] = fields.fields[CustomFieldIDs.Markets];
    this.fields[CustomFieldIDs.ScrumTeam] = defineScrumTeam();
    this.fields[CustomFieldIDs.Components] = fields.fields[CustomFieldIDs.Components];
    // see discussion in https://jira.pmidce.com/browse/DCE20TAF-137?focusedCommentId=1253904&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-1253904
    // this.fields[customFieldNameFromID(CustomFieldIDs.Requirement)] =
    //   testFields.fields[customFieldNameFromID(CustomFieldIDs.Requirement)];
  }

  set sprint(sprint: JiraSprint) {
    this.fields[CustomFieldIDs.Sprint] = sprint.id;
  }

  fields: {
    project: { key: string };
    summary: string;
    description: string;
    issuetype: { name: IssueTypes };
    labels: string[];
    [CustomFieldIDs.Environment]?: Field[];
    [CustomFieldIDs.ReevEnvironment]?: Field;
    [CustomFieldIDs.Markets]: Field[];
    [CustomFieldIDs.ScrumTeam]: Field | ReevField;
    [CustomFieldIDs.EpicLink]?: string;
    [CustomFieldIDs.Components]?: { name: string }[];
    [CustomFieldIDs.Sprint]?: number;
    [CustomFieldIDs.Severity]?: { id: ReevSeverity };
    [CustomFieldIDs.IdentifiedBy]?: { id: IdentifiedBy };
  };
}

export const getBugJiraID = async (
  resultsData: ParsedScenarioResultsData,
): Promise<string> => {
  const stackTrace =
    typeof resultsData.errorMessage === "string"
      ? resultsData.errorMessage.replace(/\\n/g, "\n")
      : "";

  const summary = generateSummary(resultsData, false);
  const environment = generateBugEnvironment();
  const jql = generateJQL(summary, environment);

  const query: JiraQuery = {
    jql: jql,
    optional: {
      fields: ["description", "summary"],
      maxResults: 10,
    },
  };

  const queryResponse = await findIssues(query);

  if (queryResponse.issues.length > 0) {
    const existingBugNumber = queryResponse.issues.find((element) =>
      element.fields.description.includes(stackTrace),
    );
    if (existingBugNumber !== undefined) {
      logger.info(`Found existing bug: ${existingBugNumber.key}`, pathToWriteLogFile);
      return existingBugNumber.key;
    }
  }
  const { key } = await createJiraBug(resultsData);
  return key;
};

export const createJiraBug = async (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): Promise<JiraIssueResponse> => {
  const failedStepIndex = findFailedStep(resultsData);
  const summary = generateSummary(resultsData, true);
  const description = generateBugDescription(resultsData, failedStepIndex);
  const component = getComponentName(resultsData.name.toString(), resultsData);

  const bug = new BugReport(
    projectIssueKeys().bug,
    summary.slice(0, 255),
    description,
    [...resultsData.manualTcts],
    new BugReportFields(resolvedEnvironmentName(), resolvedMarketName(), component),
  );
  if (isReev() && projectIssueKeys().scrumBoard) {
    bug.sprint = await getLastSprint();
  }
  logger.info(`Bug request: ${JSON.stringify(bug)}`, pathToWriteLogFile);
  try {
    const newBugResponse = await jira.addNewIssue(bug);
    logger.info(`Bug response: ${JSON.stringify(newBugResponse)}`, pathToWriteLogFile);
    if (!isIntegrationTestsEnabled())
      await addAttachment(
        newBugResponse.key,
        path.join(
          `${pathToWriteParsedResultsData}/${resultsData.stepDescriptions[failedStepIndex]}.png`,
        ),
      );
    return newBugResponse;
  } catch (error) {
    logger.error(
      `Error when creating new bug report: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const getMatchingKeywords = (name: string): any => {
  return name.match(
    new RegExp(`\\b(${Keywords.CEAPP}|${Keywords.WEB}|${Keywords.SFSC})\\b`, `g`),
  );
};

export const getComponentName = (
  name: string,
  resultsData?: ParsedScenarioResultsData | ParsedFeatureResultsData,
): string[] => {
  const keyword =
    name === "" || getMatchingKeywords(name) === null
      ? ""
      : getMatchingKeywords(name)[0];

  switch (envHandler.getVariable("PROJECTS")) {
    case Projects.GAM:
    case Projects.SIT:
    case Projects.Default:
      return [];
    case Projects.DCE20IMP:
    case Projects.RollIn:
      if (keyword?.includes(Keywords.CEAPP)) return ["Clientelling"];
      if (keyword?.includes(Keywords.WEB)) return ["Consumer_website"];
      if (keyword?.includes(Keywords.SFSC)) return ["Consumer_care"];
      return [];
    case Projects.RCGC:
      return ["SF CG Cloud"];
    case Projects.RB2BCC:
      return ["Service Cloud"];
    case Projects.EXPC:
      return ["Experience Cloud"];
    case Projects.MULE:
      return ["B2B Mulesoft"];
    case Projects.ORCH:
      return ["Orchestration"];
    case Projects.MKTC:
      return ["Marketing Cloud"];
    case Projects.SEGN:
      return ["REEV Segmentation"];

    case Projects.REEVE2E:
      return getEnd2EndComponents(resultsData);
    default:
      return [];
  }
};
function generateBugEnvironment() {
  return isReev()
    ? ""
    : `AND "Environment (DCE20HOME)" = "${resolvedEnvironmentName()}"`;
}

export function generateJQL(summary: string, environment: string) {
  let label = "AND labels = TAF";
  if (isReev()) label = "";
  return `project = ${projectIssueKeys().bug.toString()} AND \
((not status in (Closed, Done)) OR (status in (Closed, Done) AND resolution in (Duplicate, "Won't Do", "Can't Do"))) AND \
type = bug AND summary ~ "${summary
    .replace(/ - /g, " ")
    .replace(
      /"/g,
      "\\",
    )}" ${label} AND reporter = s-test-automation AND "Market/s" = "${resolvedMarketName()}" ${environment} Order BY createdDate DESC`;
}

export function generateBugDescription(
  resultsData: ParsedScenarioResultsData,
  screenshot: number,
) {
  let description = "Test case";
  if (!isReev()) {
    description += `: "${resultsData.name.toString()}"`;
  }
  description += ` failed when performing: "${
    resultsData.stepDescriptions[screenshot]
  }" because of error: 
  
  {code}
  ${
    typeof resultsData.errorMessage === "string"
      ? resultsData.errorMessage.replace(/\\n/g, "\n")
      : ""
  }{code}
  
  
  ${
    isIntegrationTestsEnabled()
      ? ""
      : `Page URL: 
  {code}
  ${resultsData.currentUrl}{code}

  User data:
  {code}
  Email: ${resultsData.userEmail}
  UID: ${resultsData.userUID}
  {code}
  
  See screenshot attached bellow`
  }`;
  return description;
}

export function generateSummary(
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
  addEnvironmentInformation: boolean,
) {
  const failedStepIndex = findFailedStep(resultsData);
  let summary = "";
  if (addEnvironmentInformation) {
    summary = `[${envHandler.getVariable("MARKET")}] - [${envHandler.getVariable(
      "LANGUAGE",
    )}] - `;
  }
  if (!isReev()) {
    summary += `${resultsData.name.toString()} - `;
  }
  summary += `${resultsData.stepDescriptions[failedStepIndex]}`;
  return summary;
}

export const getEnd2EndComponents = (
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
) => {
  const tags =
    "stepTags" in resultsData
      ? resultsData.stepTags[findFailedStep(resultsData)]
      : resultsData.tags;
  return tags.filter((tag) => tag in reevTags).map((item) => reevTags[item]);
};
