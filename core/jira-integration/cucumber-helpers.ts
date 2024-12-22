import { FeatureStep, Step } from "./jira-step";
import logger from "../logger";
import { pathToWriteLogFile, pathToReadCucumberResultsDirectory } from "./jira-consts";
import { ApiTestTags } from "./api-tags-helper";
import * as fs from "fs";
import {
  Projects,
  ReevTestKinds,
  TestKinds,
  isReev,
  TestExecutionLevels,
} from "./jira-helpers";
import environmentHandler from "../envHandler";
import { CucumberStep } from "../../interfaces/jira/cucumber-step";
import { Field } from "../../interfaces/jira/field";
import { ReevField } from "interfaces/jira/reev-field";
import { ParsedScenarioResultsData } from "interfaces/jira/parsed-scenario-results-data";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";
import _ from "lodash";

export enum CucumberStepStatuses {
  Passed = "passed",
  Failed = "failed",
  Skipped = "skipped",
}

export enum TagRegex {
  "@manualTct" = `(?!^@manualTct:)\\w+-\\d+`,
  "@requirement" = `(?!^@requirement:)\\w+-\\d+`,
  "@testLevel" = `(?!^@testLevel:):\\w+-?\\d*`,
  "@testKind" = `(?!^@testKind:):\\w+-?\\d*`,
}

export class ScenarioData {
  constructor() {
    this.stepsRows = [];
    this.stepStatuses = [];
    this.testCaseStatus = CucumberStepStatuses.Passed;
    this.scenarioName = "";
    this.screenShots = [];
    this.currentUrl = "";
    this.stepDescriptions = [];
    this.errorMessage = "";
  }

  stepsRows: Step[];

  stepStatuses: CucumberStepStatuses[];

  scenarioName: string;

  testCaseStatus: CucumberStepStatuses;

  screenShots: string[];

  currentUrl: string;

  stepDescriptions: string[];

  errorMessage: string;

  scriptPath: string;

  userEmail?: string;

  userUID?: string;

  tags?: string[];

  hsSession?: string;
}

export function isIntegrationTestsEnabled(): boolean {
  return (environmentHandler.getVariable("API_TEST") + "").toLowerCase() === "true";
}

export function isTestPlanProvided(): boolean {
  return !!environmentHandler.getVariable("JIRA_TEST_PLAN_KEY");
}

export function defineTestLevel(tags?: string[]): Field | ReevField {
  const testLevel = [];
  if (!isReev()) {
    isIntegrationTestsEnabled() ? testLevel.push("Integration") : testLevel.push("E2E");
    return { value: testLevel[0] };
  }

  if (environmentHandler.getVariable("PROJECTS") === Projects.REEVE2E)
    return { id: "20297" };

  for (const tag of filterTags(tags, "@testLevel")) {
    return { id: TestExecutionLevels[tag.slice(1)] };
  }
  logger.warn("Test Level tags not defined, setting up default one");
  return { id: "20295" };
}

export function defineTestKinds(tags?: string[]): Field[] | ReevField[] {
  const testKind = [];
  if (!isReev()) {
    isIntegrationTestsEnabled()
      ? testKind.push({ value: TestKinds.Functional })
      : testKind.push(
          { value: TestKinds.Regression },
          { value: TestKinds.Acceptance },
          { value: TestKinds.GUI },
          { value: TestKinds.Functional },
        );
    return testKind;
  }
  for (const tag of filterTags(tags, "@testKind")) {
    testKind.push({ id: ReevTestKinds[tag.slice(1)] });
  }
  if (testKind.length > 0) return testKind;
  logger.warn("Test Kind not defined, setting up Functional");
  return [{ id: ReevTestKinds.Functional }];
}

export function defineLabels(destination: string): string[] {
  const testLabels = [];
  if (destination === "tct") testLabels.push("CC_Hybris-API_Regression_Pack");
  else
    testLabels.push(
      `CC_${environmentHandler
        .getVariable("ENVIRONMENT")
        .toUpperCase()}_Hybris-API_Regression_Pack`,
    );
  return testLabels;
}

export function getCucumberJsonReportFileContent(): string {
  const cucumberResultFileNames = fs.readdirSync(pathToReadCucumberResultsDirectory);
  const fileData = fs.readFileSync(
    `${pathToReadCucumberResultsDirectory}/${cucumberResultFileNames}`,
    "utf8",
  );
  //we need to remove square brackets cause json file format is invalid
  return fileData.slice(1, -1);
}

export const parseStepsFromResultFile = (data: string): ParsedScenarioResultsData[] => {
  const resultData: ParsedScenarioResultsData[] = [];
  try {
    for (const feature of JSON.parse(data)) {
      const scenarios = feature.elements;
      for (const scenario of scenarios) {
        const manualTcts: string[] = filterTags(
          extractTags(scenario.tags),
          "@manualTct",
        );
        const requirements: string[] = filterTags(
          extractTags(scenario.tags),
          "@requirement",
        );
        const tags: string[] = filterTags(extractTags(scenario.tags));
        const scenarioData = extractScenarioData(scenario.steps);

        resultData.push({
          name: scenario.name,
          manualTcts,
          requirements,
          tags,
          fields: { customfield_18001: { stepsRows: scenarioData.stepsRows } },
          ...scenarioData,
        });
      }
    }
  } catch (error) {
    logger.error(
      `Error when parsing results: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
  return resultData;
};

export function filterTags(tags: string[], regex?: string): string[] {
  if (!tags) return [];
  if (!regex) {
    return tags;
  }
  const filteredTags: string[] = [];
  for (const tag of tags) {
    if (tag.includes(regex)) {
      filteredTags.push(tag.match(new RegExp(TagRegex[regex], "g"))[0]);
    }
  }
  return filteredTags;
}

export function extractTags(tags: { name: string }[]): string[] {
  return tags.map((tag) => tag.name);
}

export function extractScenarioData(steps: CucumberStep[]): ScenarioData {
  const scenarioData: ScenarioData = new ScenarioData();
  scenarioData.testCaseStatus = CucumberStepStatuses.Passed;

  if (isIntegrationTestsEnabled()) {
    const apiTestsRunReportFile = getCucumberJsonReportFileContent();
    const json = JSON.parse(apiTestsRunReportFile);
    scenarioData.scriptPath = json.uri.replace(/\\/g, "/");
    ApiTestTags.getInstance().getTagsAmount();
  }

  if (steps[0].embeddings?.length < 1) {
    scenarioData.scriptPath = steps[0].embeddings[0]?.data;
  }
  const beforeHooks = steps.filter((step) => step.keyword === "Before");

  for (const [index, step] of steps.entries()) {
    if (step.name !== "" && step.name !== "Hook") {
      if (isIntegrationTestsEnabled() && step.name === undefined) {
        step.name = ApiTestTags.getInstance().getTag();
      }
      scenarioData.stepsRows.push(new Step([`${step.keyword} ${step.name}`, "", ""]));
      scenarioData.stepStatuses.push(step.result.status);
      scenarioData.stepDescriptions.push(
        `${step.keyword} ${step.name}`.replace(/"/g, ""),
      );
      if (step.result.status === CucumberStepStatuses.Failed) {
        scenarioData.testCaseStatus = CucumberStepStatuses.Failed;
        scenarioData.errorMessage = step.result.error_message;
      }
      if (step.embeddings?.length > 0) {
        for (const embedded of step.embeddings) {
          if (embedded["mime_type"] === "text/plain") {
            if (embedded["data"].includes("https://"))
              scenarioData.currentUrl = embedded.data;
            else if (embedded["data"].includes("@"))
              scenarioData.userEmail = embedded.data;
            else scenarioData.userUID = embedded.data;
          }
          if (embedded["mime_type"] === "image/png")
            scenarioData.screenShots[index - beforeHooks.length] = embedded.data;
        }
      }
    } else if (step.embeddings?.length > 0) {
      for (const embedded of step.embeddings) {
        if (embedded["data"].includes("HS session")) {
          console.log("*****");
          scenarioData.hsSession = embedded.data.match(/(.*-.*)*/)[0];
        }
      }
    }
  }
  return scenarioData;
}

export const parseStepsFromFeatureFile = (data: string): ParsedFeatureResultsData[] => {
  const resultData: ParsedFeatureResultsData[] = [];
  try {
    const scenarioData: ScenarioData[] = [];
    for (const feature of JSON.parse(data)) {
      const scenarios = feature.elements.reverse();
      let scenariosTags: string[];

      for (const scenario of scenarios) {
        const singleScenario: ScenarioData = extractScenarioData(scenario.steps);
        singleScenario.scenarioName = scenario.name;
        singleScenario.tags = extractTags(scenario.tags);
        scenarioData.push(singleScenario);
        scenariosTags = _.union(scenariosTags, singleScenario.tags);
      }

      const manualTcts: string[] = filterTags(scenariosTags, "@manualTct");
      const requirements: string[] = filterTags(scenariosTags, "@requirement");
      const description: string = feature.description;
      const testLevel: string[] = filterTags(scenariosTags, "@testLevel");
      const tags: string[] = filterTags(scenariosTags);

      resultData.push({
        name: `(Auto-Generated) ${feature.name}`,
        manualTcts,
        requirements,
        tags,
        description,
        stepStatuses: scenarioData.flatMap((scenario) => [
          undefined,
          ...scenario.stepStatuses,
        ]),
        stepDescriptions: scenarioData.flatMap((scenario) => [
          undefined,
          ...scenario.stepDescriptions,
        ]),
        fields: {
          customfield_18001: {
            stepsRows: scenarioData.flatMap((scenario) => prepareRows(scenario)),
          },
        },
        testLevel,
        currentUrl: scenarioData
          .map((item) => item.currentUrl)
          .filter((item) => !!item)
          .pop(),
        testCaseStatus: getTestStatus(scenarioData),
        scriptPath: scenarios[0].steps[0].embeddings[0].data,
        errorMessage: getErrorMessage(scenarioData),
        screenShots: scenarioData.flatMap((scenario) => scenario.screenShots),
        stepTags: scenarioData.flatMap((scenario) => [
          undefined,
          ...scenario.stepDescriptions.map(() => scenario.tags),
        ]),
      });
    }
  } catch (error) {
    logger.error(
      `Error when parsing results: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }

  return resultData;
};

export function prepareRows(scenario: ScenarioData): Step[] {
  const steps: Step[] = [];
  steps.push(new FeatureStep([`${scenario.scenarioName}`, "", ""], true));
  for (const step of scenario.stepsRows) {
    steps.push(new FeatureStep([step.cells.toString(), "", ""], step.isGroup));
  }
  return steps;
}

export function getTestStatus(scenarioData: ScenarioData[]): CucumberStepStatuses {
  return scenarioData
    .flatMap((scenario) => scenario.stepStatuses)
    .includes(CucumberStepStatuses.Failed || CucumberStepStatuses.Skipped)
    ? CucumberStepStatuses.Failed
    : CucumberStepStatuses.Passed;
}

export function getErrorMessage(scenarioData: ScenarioData[]): string {
  return scenarioData
    .flatMap((scenario) => scenario.errorMessage)
    .find((item) => !!item);
}
