import { getCucumberJsonReportFileContent } from "./cucumber-helpers";
import { ApiTestsRunJsonReportTags } from "../../interfaces/jira/api-tests-run-json-report-tags";

export class ApiTestTags {
  private static instance: ApiTestTags;

  static getInstance(): ApiTestTags {
    return ApiTestTags.instance
      ? ApiTestTags.instance
      : (ApiTestTags.instance = new ApiTestTags());
  }

  tags: string[] = [];

  getTags(): string[] {
    const reportFileContent = getCucumberJsonReportFileContent();
    const json = JSON.parse(reportFileContent);
    const elementObjects = Object.values(json.elements) as ApiTestsRunJsonReportTags[];

    for (const element of elementObjects) {
      for (const tag of element.tags) {
        this.tags.push(tag.name);
      }
    }
    return this.tags;
  }

  getTagsAmount(): number {
    return this.getTags().length;
  }

  getTag(): string {
    return this.tags.pop();
  }
}
