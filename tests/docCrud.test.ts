import { describe, expect, it, vi } from "vitest";
import "./setup.js";
import type { ClickUpGateway } from "../src/infrastructure/clickup/ClickUpGateway.js";
import { CreateDoc } from "../src/application/usecases/docs/CreateDoc.js";
import { ListDocPages } from "../src/application/usecases/docs/ListDocPages.js";
import { GetDocPage } from "../src/application/usecases/docs/GetDocPage.js";
import { UpdateDocPage } from "../src/application/usecases/docs/UpdateDocPage.js";

type DocGatewayStub = Pick<
  ClickUpGateway,
  "create_doc" | "list_doc_pages" | "get_doc_page" | "update_doc_page"
>;

describe("Doc CRUD tools", () => {
  it("Create doc maps fields and returns ref", async () => {
    const create_doc = vi.fn().mockResolvedValue({ id: "D1", title: "New", url: "https://docs/D1" });
    const gateway: DocGatewayStub = {
      create_doc,
      list_doc_pages: vi.fn(),
      get_doc_page: vi.fn(),
      update_doc_page: vi.fn()
    };
    const usecase = new CreateDoc(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { workspaceId: 2, title: "Draft" });
    expect(create_doc).toHaveBeenCalledWith(2, { title: "Draft", visibility: "PRIVATE" });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.doc.docId).toBe("D1");
    expect(result.data.doc.title).toBe("New");
  });

  it("List pages orders and hasMore", async () => {
    const list_doc_pages = vi.fn().mockResolvedValue({
      pages: [
        { id: "P1", title: "Older", updated_at: "2025-01-01T10:00:00.000Z", url: "https://docs/D1/P1" },
        { id: "P2", title: "Newer", updated_at: "2025-01-02T10:00:00.000Z", url: "https://docs/D1/P2" }
      ]
    });
    const gateway: DocGatewayStub = {
      create_doc: vi.fn(),
      list_doc_pages,
      get_doc_page: vi.fn(),
      update_doc_page: vi.fn()
    };
    const usecase = new ListDocPages(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { workspaceId: 3, docId: "D1", limit: 1, page: 0 });
    expect(list_doc_pages).toHaveBeenCalledWith(3, "D1", { limit: 1, page: 0 });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.results.length).toBe(1);
    expect(result.data.results[0].pageId).toBe("P2");
    expect(result.data.hasMore).toBe(true);
  });

  it("Get page content respects format", async () => {
    const get_doc_page = vi.fn().mockResolvedValue({
      doc_id: "D2",
      page_id: "P9",
      title: "Page",
      content: "<p>Hello</p>"
    });
    const gateway: DocGatewayStub = {
      create_doc: vi.fn(),
      list_doc_pages: vi.fn(),
      get_doc_page,
      update_doc_page: vi.fn()
    };
    const usecase = new GetDocPage(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute(
      {},
      { workspaceId: 4, docId: "D2", pageId: "P9", contentFormat: "text/html" }
    );
    expect(get_doc_page).toHaveBeenCalledWith(4, "D2", "P9", "text/html");
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.contentFormat).toBe("text/html");
    expect(result.data.content.includes("<")).toBe(true);
  });

  it("Update page applies title and content", async () => {
    const update_doc_page = vi.fn().mockResolvedValue({});
    const gateway: DocGatewayStub = {
      create_doc: vi.fn(),
      list_doc_pages: vi.fn(),
      get_doc_page: vi.fn(),
      update_doc_page
    };
    const usecase = new UpdateDocPage(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, {
      workspaceId: 5,
      docId: "D3",
      pageId: "P4",
      contentFormat: "application/json",
      content: "{\"text\":\"updated\"}",
      title: "Revised"
    });
    expect(update_doc_page).toHaveBeenCalledWith(5, "D3", "P4", {
      content_format: "application/json",
      content: "{\"text\":\"updated\"}",
      title: "Revised"
    });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.data.updated).toBe(true);
  });

  it("Character limit trimming", async () => {
    const largeContent = "A".repeat(40000);
    const get_doc_page = vi.fn().mockResolvedValue({
      doc_id: "D9",
      page_id: "PX",
      title: "Overflow",
      content: largeContent
    });
    const gateway: DocGatewayStub = {
      create_doc: vi.fn(),
      list_doc_pages: vi.fn(),
      get_doc_page,
      update_doc_page: vi.fn()
    };
    const usecase = new GetDocPage(gateway as unknown as ClickUpGateway);
    const result = await usecase.execute({}, { workspaceId: 6, docId: "D9", pageId: "PX" });
    expect(result.isError).toBe(false);
    if (result.isError) {
      throw new Error("Expected success result");
    }
    expect(result.truncated).toBe(true);
    expect(result.guidance).toBeDefined();
    expect(result.data.content.length).toBeLessThan(largeContent.length);
  });
});
