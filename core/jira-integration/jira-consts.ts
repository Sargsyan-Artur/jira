import * as path from "path";
import { createDirectory } from "../file-helpers";

// define paths
export const pathToReadCucumberResultsDirectory = path.resolve(
  ".reports/cucumberjs-json/",
);
export const pathToWriteParsedResultsData = path.resolve(".output/reports/");
export const pathToWriteLogFile = path.resolve(
  `${pathToWriteParsedResultsData}testflo.log`,
);
// create path for parsed results
createDirectory(pathToWriteParsedResultsData);
// enum containing keywords used by Scenario names
export enum Keywords {
  CEAPP = "CEAPP",
  WEB = "WEB",
  SFSC = "SFSC",
}
