import { AttachmentResponse } from "interfaces/jira/attachment-response";
import { ParsedScenarioResultsData } from "interfaces/jira/parsed-scenario-results-data";
import { ParsedFeatureResultsData } from "interfaces/jira/parsed-feature-data";
import logger from "../logger";
import { CucumberStepStatuses } from "./cucumber-helpers";
import { pathToWriteLogFile } from "./jira-consts";
import { CustomFieldIDs, isReev, jira } from "./jira-helpers";

export class Step {
  constructor(cells: string[]) {
    this.isGroup = false;
    this.cells = cells;
  }

  isGroup: boolean;

  cells: string[];
}

export class FeatureStep {
  constructor(cells: string[], isGroup: boolean) {
    this.isGroup = isGroup;
    this.cells = cells;
  }

  isGroup: boolean;

  cells: string[];
}

const TestFloStepStatuses = {
  passed: { ids: [3], name: "Pass", color: "#51a825", isFinalStatus: true },
  failed: { ids: [4], name: "Fail", color: "#CC3300", isFinalStatus: true },
  skipped: { ids: [1], name: "To do", color: "#CCCCCC", isFinalStatus: false },
};

class StepUpdateRequest {
  constructor(stepRows: StepUpdate[]) {
    this.stepsVersion = 1;
    this.stepsRows = stepRows;
    this.stepsColumns = [
      { name: "Action", size: 150 },
      { name: "Input", size: 150 },
      { name: "Expected result", size: 150 },
    ];
    this.stepsStatuses = [
      { ids: [1], name: "To do", color: "#CCCCCC", isFinalStatus: false },
      { ids: [2], name: "In progress", color: "#6693B0", isFinalStatus: false },
      { ids: [3], name: "Pass", color: "#51a825", isFinalStatus: true },
      { ids: [4], name: "Fail", color: "#CC3300", isFinalStatus: true },
    ];
    this.defaultStatus = {
      ids: [1],
      name: "To do",
      color: "#CCCCCC",
      isFinalStatus: false,
    };
    this.onLoadConfigurationHash = "dc143aa66153032c7658507691943191";
  }

  stepsVersion: number;

  stepsRows: StepUpdate[];

  stepsColumns: { name: string; size: number }[];

  stepsStatuses: StepFullStatus[];

  defaultStatus: StepFullStatus;

  onLoadConfigurationHash: string;

  stepName?: string;
}

class StepFeatureUpdateRequest extends StepUpdateRequest {
  constructor(stepRows: StepFeatureUpdate[]) {
    super(stepRows);
    this.stepsRows = stepRows;
  }
}

export class StepUpdate {
  constructor(cells: string[], status: StepFullStatus) {
    this.status = status;
    this.isGroup = false;
    this.cells = cells;
    this.renderedCells = [`<p>${cells[0]}</p>`, "", ""];
  }

  status: StepFullStatus;

  isGroup: boolean;

  cells: string[];

  renderedCells: string[];

  defects?: { key: string }[];

  attachments?: StepAttachment[];
}

export class StepFeatureUpdate extends StepUpdate {
  constructor(cells: string[], status: StepFullStatus, isGroup: boolean) {
    super(cells, status);
    this.isGroup = isGroup;
  }
}

class StepFullStatus {
  ids: number[];

  name: string;

  color: string;

  isFinalStatus: boolean;
}

export class StepStatus {
  constructor(rowIndex: string, status: string) {
    this.rowIndex = rowIndex;
    this.status = status;
  }

  rowIndex: string;

  status: string;
}

class StepAttachment {
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.temporary = false;
  }

  id: string;

  name: string;

  temporary: boolean;
}

export const linkAttachmentWithStep = async (
  id: string,
  requestData: StepUpdateRequest | StepFeatureUpdateRequest,
): Promise<any> => {
  return await jira.doRequest(
    jira.makeRequestHeader(
      jira.makeUri({
        pathname: `/${id}`,
        query: "update-history=true",
        intermediatePath: "/rest/tms/1.0/steps",
      }),
      {
        method: "POST",
        followAllRedirects: true,
        body: requestData,
      },
    ),
  );
};

export const updateStepsStatusAndAttachment = async ({
  testCaseId,
  resultsData,
  bugNumber,
  screenshotTable,
}: {
  testCaseId: string;
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData;
  bugNumber?: string;
  screenshotTable?: Array<AttachmentResponse>;
}): Promise<any> => {
  const rows = addScreenshotsToSteps(
    resultsData as ParsedScenarioResultsData,
    screenshotTable,
    bugNumber,
  );
  const requestData = !isReev
    ? new StepUpdateRequest(rows)
    : new StepFeatureUpdateRequest(rows);
  logger.info(
    `Test Case Step Linking Attachments request: ${JSON.stringify(requestData)}`,
    pathToWriteLogFile,
  );
  try {
    const response = await linkAttachmentWithStep(testCaseId, requestData);
    logger.info(
      `Test Case Step Linking Attachments response: ${JSON.stringify(response)}`,
      pathToWriteLogFile,
    );
    return response;
  } catch (error) {
    logger.error(
      `Error when linking attachments to step : ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};

export function addScreenshotsToSteps(
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
  screenshotTable: AttachmentResponse[],
  bugNumber?: string,
): StepUpdate[] | StepFeatureUpdate[] {
  const rows = !isReev
    ? convertToStepRows(resultsData)
    : convertToStepRowsAndGroups(resultsData);
  const failedStepIndex = findFailedStep(resultsData);
  if (screenshotTable?.length > 0) {
    if (failedStepIndex !== -1 && bugNumber !== undefined)
      rows[failedStepIndex].defects = [{ key: bugNumber }];
    if (screenshotTable.length === 1 && failedStepIndex !== -1) {
      rows[failedStepIndex].attachments = [
        new StepAttachment(screenshotTable[0].id, screenshotTable[0].filename),
      ];
    } else {
      addAttachmentToRows(rows, screenshotTable);
    }
  }
  return rows;
}

function addAttachmentToRows(
  rows: StepUpdate[] | StepFeatureUpdate[],
  screenshotTable: AttachmentResponse[],
) {
  let index = 0;
  for (const element of screenshotTable) {
    if (rows[index].isGroup) index++;
    rows[index].attachments = [new StepAttachment(element.id, element.filename)];
    index++;
  }
}

export function convertToStepRows(
  resultsData: ParsedScenarioResultsData,
): StepUpdate[] {
  return resultsData.fields[CustomFieldIDs.TestSteps].stepsRows.map(
    (value, index) =>
      new StepUpdate(value.cells, TestFloStepStatuses[resultsData.stepStatuses[index]]),
  );
}

export function convertToStepRowsAndGroups(
  resultsData: ParsedScenarioResultsData,
): StepFeatureUpdate[] {
  return resultsData.fields[CustomFieldIDs.TestSteps].stepsRows.map(
    (value, index) =>
      new StepFeatureUpdate(
        value.cells,
        TestFloStepStatuses[resultsData.stepStatuses[index]],
        value.isGroup,
      ),
  );
}

export function findFailedStep(resultsData: ParsedScenarioResultsData): number {
  return resultsData.stepStatuses.indexOf(CucumberStepStatuses.Failed);
}

export function findFailedSteps(
  resultsData: ParsedScenarioResultsData | ParsedFeatureResultsData,
): number[] {
  const indexes: number[] = [];
  const filteredSteps = resultsData.stepStatuses.filter((item) => !!item);
  for (const index in filteredSteps) {
    if (filteredSteps[index] === CucumberStepStatuses.Failed)
      indexes.push(Number(index));
  }
  return indexes;
}
