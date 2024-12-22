import logger from "../logger";
import { pathToWriteLogFile } from "./jira-consts";
import { jira } from "./jira-helpers";
import { JiraQueryResponse } from "interfaces/jira/jira-query-response";
import { JiraQuery } from "interfaces/jira/jira-query";

export const findIssues = async (query: JiraQuery): Promise<JiraQueryResponse> => {
  logger.info(`JQL search: ${JSON.stringify(query.jql)}`, pathToWriteLogFile);
  try {
    const searchResponse = await jira.searchJira(query.jql, query.optional);
    logger.debug(
      `Search response for JQL ${query.jql}: ${JSON.stringify(searchResponse)}`,
      pathToWriteLogFile,
    );
    return searchResponse;
  } catch (error) {
    logger.error(
      `Error when executing search query: ${error} at: ${error.stack}. Continuing...`,
      pathToWriteLogFile,
    );
  }
};
