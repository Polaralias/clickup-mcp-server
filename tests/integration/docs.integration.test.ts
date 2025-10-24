import { describe, expect, it, vi } from "vitest";
import "../setup.js";
import { CreateDoc } from "../../src/application/usecases/docs/CreateDoc.js";
import { UpdateDocPage } from "../../src/application/usecases/docs/UpdateDocPage.js";
import { GetDocPage } from "../../src/application/usecases/docs/GetDocPage.js";
import type { ClickUpGateway } from "../../src/infrastructure/clickup/ClickUpGateway.js";
import * as runtime from "../../src/config/runtime.js";

describe("Doc lifecycle integration", () => {
  it("creates, updates, and retrieves with deterministic truncation", async () => {
    const limitSpy = vi.spyOn(runtime, "characterLimit");
    limitSpy.mockReturnValueOnce(60).mockReturnValueOnce(30).mockReturnValue(40);
    const gateway = {
      create_doc: vi.fn().mockResolvedValue({
        doc: { id: "DOC-1", url: "https://app/docs/DOC-1", title: "T".repeat(200) }
      }),
      update_doc_page: vi.fn().mockResolvedValue(null),
      get_doc_page: vi.fn().mockImplementation(() =>
        Promise.resolve({ doc_id: "DOC-1", page_id: "PAGE-1", title: "Chapter", content: "X".repeat(500) })
      )
    } satisfies Partial<ClickUpGateway>;
    const createUsecase = new CreateDoc(gateway as ClickUpGateway);
    const updateUsecase = new UpdateDocPage(gateway as ClickUpGateway);
    const getUsecase = new GetDocPage(gateway as ClickUpGateway);
    const createResult = await createUsecase.execute({}, { workspaceId: 42, title: "T".repeat(200), visibility: "PUBLIC" });
    expect(createResult.isError).toBe(false);
    if (createResult.isError) {
      throw new Error("Expected success");
    }
    expect(createResult.truncated).toBe(true);
    expect(createResult.data.truncated).toBe(true);
    expect(createResult.data.guidance).toBe("Output trimmed to character_limit");
    expect(createResult.data.doc.docId).toBe("DOC-1");
    expect(createResult.data.doc.title?.length).toBeLessThan(200);
    const dryRun = await updateUsecase.execute(
      {},
      {
        workspaceId: 42,
        docId: "DOC-1",
        pageId: "PAGE-1",
        contentFormat: "text/md",
        content: "# Heading\n" + "C".repeat(120),
        dryRun: true
      }
    );
    expect(dryRun.isError).toBe(false);
    if (dryRun.isError) {
      throw new Error("Expected success");
    }
    expect(dryRun.data.dryRun).toBe(true);
    expect(gateway.update_doc_page).not.toHaveBeenCalled();
    const updateResult = await updateUsecase.execute(
      {},
      {
        workspaceId: 42,
        docId: "DOC-1",
        pageId: "PAGE-1",
        contentFormat: "text/md",
        content: "# Heading\n" + "C".repeat(120)
      }
    );
    expect(updateResult.isError).toBe(false);
    if (updateResult.isError) {
      throw new Error("Expected success");
    }
    expect(updateResult.truncated).toBe(true);
    expect(updateResult.data.truncated).toBe(true);
    expect(gateway.update_doc_page).toHaveBeenCalledWith(42, "DOC-1", "PAGE-1", {
      content_format: "text/md",
      content: "# Heading\n" + "C".repeat(120)
    });
    const firstRead = await getUsecase.execute({}, { workspaceId: 42, docId: "DOC-1", pageId: "PAGE-1", contentFormat: "text/md" });
    expect(firstRead.isError).toBe(false);
    if (firstRead.isError) {
      throw new Error("Expected success");
    }
    expect(firstRead.truncated).toBe(true);
    expect(firstRead.data.truncated).toBe(true);
    expect(firstRead.data.content.length).toBeLessThan(500);
    expect(firstRead.data.guidance).toBe("Output trimmed to character_limit");
    const secondRead = await getUsecase.execute({}, { workspaceId: 42, docId: "DOC-1", pageId: "PAGE-1", contentFormat: "text/md" });
    expect(secondRead.isError).toBe(false);
    if (secondRead.isError) {
      throw new Error("Expected success");
    }
    expect(secondRead.data.content).toBe(firstRead.data.content);
    expect(secondRead.data.title).toBe(firstRead.data.title);
    limitSpy.mockRestore();
  });
});
