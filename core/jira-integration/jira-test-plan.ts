import {
  CustomFieldIDs,
  JiraIssue,
  IssueTypes,
  getIssueID,
  defineEnvironment,
  defineScrumTeam,
  getLastSprint,
  isHybris,
} from "./jira-helpers";
import logger from "../logger";
import { pathToWriteLogFile } from "./jira-consts";
import {
  resolvedEnvironmentName,
  resolvedMarketName,
  projectIssueKeys,
  jira,
  isReev,
} from "./jira-helpers";
import _ from "lodash";
import envHandler from "utils/envHandler";
import { Field } from "interfaces/jira/field";
import { ReevField } from "interfaces/jira/reev-field";
import { JiraIssueResponse } from "interfaces/jira/jira-issue-response";
import { TestPlanSubtask } from "interfaces/jira/test-plan-subtask";
import { JiraSprint } from "interfaces/jira/jira-sprint";
import { EpicMarkets } from "./jira-helpers";
import { defineLabels, isTestPlanProvided } from "./cucumber-helpers";

export class TestPlanFields {
  constructor(environment: string, markets: string) {
    this.fields = {
      [isReev() ? CustomFieldIDs.ReevEnvironment : CustomFieldIDs.Environment]:
        defineEnvironment(environment),
      [CustomFieldIDs.Markets]: [
        {
          value: markets, // single value array is supported as there is no possibility to test on different markets at the same time
        },
      ],
    };
  }

  fields: {
    [CustomFieldIDs.Environment]?: Field[];
    [CustomFieldIDs.ReevEnvironment]?: ReevField;
    [CustomFieldIDs.Markets]: Field[];
  };
}
export class TestPlan extends JiraIssue {
  constructor(
    projectKey: string,
    summary: string,
    description: string,
    fields: TestPlanFields,
  ) {
    super(projectKey, summary, description);
    this.fields.issuetype = { name: IssueTypes.TestPlan };
    if (isReev()) {
      this.fields[CustomFieldIDs.ReevEnvironment] =
        fields.fields[CustomFieldIDs.ReevEnvironment];
      this.fields[CustomFieldIDs.ScrumTeam] = defineScrumTeam();
    } else {
      this.fields[CustomFieldIDs.Environment] =
        fields.fields[CustomFieldIDs.Environment];
      this.fields[CustomFieldIDs.TestType] = { value: "OTHER" };
    }
    if (isHybris()) this.fields[CustomFieldIDs.Labels] = defineLabels("tp");
    this.fields[CustomFieldIDs.Markets] = fields.fields[CustomFieldIDs.Markets];
    this.fields[CustomFieldIDs.EpicLink] =
      EpicMarkets[envHandler.getVariable("MARKET")];
  }

  set sprint(sprint: JiraSprint) {
    this.fields[CustomFieldIDs.Sprint] = sprint.id;
  }

  fields: {
    project: { key: string };
    summary: string;
    description: string;
    issuetype: { name: IssueTypes };
    [CustomFieldIDs.Environment]?: Field[];
    [CustomFieldIDs.ReevEnvironment]?: ReevField;
    [CustomFieldIDs.Markets]: Field[];
    [CustomFieldIDs.EpicLink]?: string;
    [CustomFieldIDs.ScrumTeam]?: Field | ReevField;
    [CustomFieldIDs.TestType]: Field;
    [CustomFieldIDs.Sprint]?: number;
  };
}

export const createNewTestPlan = async (): Promise<JiraIssueResponse> => {
  // TP name/title in Jira
  let tpSummary = `TAF Regression - environment:${envHandler.getVariable(
    "ENVIRONMENT",
  )} - market:${envHandler.getVariable("MARKET")} - language:${envHandler.getVariable(
    "LANGUAGE",
  )} - browser:${envHandler.getVariable("BROWSER")}`;

  tpSummary = !isReev() ? tpSummary : `(Auto-Generated) ${tpSummary}`;

  const tpDescription = `This is a Test Plan created automatically by Test Automation Framework.
  
  This Test Plan is a part of: Regression Test suite for: ${envHandler.getVariable(
    "MARKET",
  )} Market configuration executed on: ${envHandler.getVariable("BROWSER")} browser.
  
  See lists of Test Cases under Test Plan for details.
  
  See https://confluence.pmidce.com/x/4TVPE for details.`;

  const testFields = new TestPlanFields(
    resolvedEnvironmentName(),
    resolvedMarketName(),
  );
  const testPlan = new TestPlan(
    projectIssueKeys().testPlan,
    tpSummary,
    tpDescription,
    testFields,
  );
  if (isReev() && projectIssueKeys().scrumBoard) {
    testPlan.sprint = await getLastSprint();
  }
  logger.info(
    `Test Plan request:
  ${JSON.stringify(testPlan)}`,
    pathToWriteLogFile,
  );
  try {
    const tpResponse = await jira.addNewIssue(testPlan);
    logger.info(
      `Test Plan response:
    ${JSON.stringify(tpResponse)}`,
      pathToWriteLogFile,
    );
    return tpResponse;
  } catch (error) {
    logger.error(
      `Failure when creating Test Plan: ${error} at: ${error.stack}. Aborting...`,
      pathToWriteLogFile,
    );
    throw `Failure when creating Test Plan. Aborting...`;
  }
};
export const createNewTestPlanIteration = async (
  testPlanId: string,
): Promise<void | string> => {
  try {
    const request = jira.makeRequestHeader(
      jira.makeUri({
        pathname: "/moveToNextIteration",
        query: { testPlanIdOrKey: testPlanId },
        intermediatePath: "/rest/tms/1.0/api/testplan",
      }),
      {
        "Content-Type": "application/json; charset=UTF-8",
        method: "POST",
        followAllRedirects: true,
        body: { nextIterationStrategy: "all-test-cases" },
      },
    );
    const response = await jira.doRequest(request);
    if (response) {
      logger.info(`New iteration response: ${JSON.stringify(response, null, 2)}`);
    }
    return response;
  } catch (error) {
    logger.error(
      `Failure when creating Test Plan Iteration: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export const getTestPlanKey = async (): Promise<string> => {
  // eslint-disable-next-line unicorn/no-await-expression-member
  if (!isTestPlanProvided()) return (await createNewTestPlan()).key;
  const testPlanId = await getIssueID(envHandler.getVariable("JIRA_TEST_PLAN_KEY"));
  await createNewTestPlanIteration(testPlanId);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  return envHandler.getVariable("JIRA_TEST_PLAN_KEY");
};

export const getTagsOfAllTctsFromTestPlan = async (
  testPlanKey: string,
): Promise<string> => {
  const testPlan = await jira.getIssue(testPlanKey);
  const subtasks = <Array<TestPlanSubtask>>testPlan.fields.subtasks;

  let tagsArray: string[] = [];
  for (const subtask of subtasks) {
    tagsArray = tagsArray.concat(await getTagsFromSubtask(subtask));
  }
  return _.uniq(tagsArray).join(" or ");
};

export const getTagsGeneric = async (subtask: TestPlanSubtask): Promise<string[]> => {
  let manualTctArray: string[] = subtask.fields.description
    .split("\n")[0]
    .match(/: .*/)[0]
    .split(/[ ,]+/);
  manualTctArray.shift();
  manualTctArray = manualTctArray
    .filter((manualTct) => manualTct)
    .map((manualTct) => `@manualTct:${manualTct}`);
  return manualTctArray;
};

export const getTagsReev = async (subtask: TestPlanSubtask): Promise<string[]> => {
  return subtask.fields.issuelinks
    .filter(
      (issue) => issue.outwardIssue?.fields.issuetype.name === "Test Case Template",
    )
    .map((issue) => `@manualTct:${issue.outwardIssue.key}`);
};

export const getTagsFromSubtask = async (
  subtask: TestPlanSubtask,
): Promise<string[]> => {
  const subtaskTct = await jira.getIssue(subtask.key);
  return isReev() ? getTagsReev(subtaskTct) : getTagsGeneric(subtaskTct);
};
