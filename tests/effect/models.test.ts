/**
 * Tests for Effect domain models and schemas.
 */
import { describe, expect, it } from "bun:test"
import {
  WorkspaceIdSchema,
  ColsSchema,
  RowsSchema,
  LayoutModeSchema,
  type WorkspaceId,
  type Cols,
  type Rows,
  type SessionId,
} from "../../src/effect/types"
import {
  createRectangle,
  createEmptySessionIndex,
  SerializedSessionSchema,
  RectangleSchema,
} from "../../src/effect/models"

describe("Branded Types", () => {
  describe("WorkspaceId", () => {
    it("accepts valid workspace IDs (1-9)", () => {
      expect(WorkspaceIdSchema.parse(1)).toBe(1 as WorkspaceId)
      expect(WorkspaceIdSchema.parse(5)).toBe(5 as WorkspaceId)
      expect(WorkspaceIdSchema.parse(9)).toBe(9 as WorkspaceId)
    })

    it("rejects invalid workspace IDs", () => {
      expect(() => WorkspaceIdSchema.parse(0)).toThrow()
      expect(() => WorkspaceIdSchema.parse(10)).toThrow()
      expect(() => WorkspaceIdSchema.parse(-1)).toThrow()
    })
  })

  describe("Cols and Rows", () => {
    it("accepts positive integers", () => {
      expect(ColsSchema.parse(80)).toBe(80 as Cols)
      expect(RowsSchema.parse(24)).toBe(24 as Rows)
    })

    it("rejects zero and negative values", () => {
      expect(() => ColsSchema.parse(0)).toThrow()
      expect(() => RowsSchema.parse(-1)).toThrow()
    })
  })

  describe("LayoutMode", () => {
    it("accepts valid layout modes", () => {
      expect(LayoutModeSchema.parse("vertical")).toBe("vertical")
      expect(LayoutModeSchema.parse("horizontal")).toBe("horizontal")
      expect(LayoutModeSchema.parse("stacked")).toBe("stacked")
    })

    it("rejects invalid layout modes", () => {
      expect(() => LayoutModeSchema.parse("invalid")).toThrow()
    })
  })
})

describe("Domain Models", () => {
  describe("Rectangle", () => {
    it("creates valid rectangles", () => {
      const rect = createRectangle({ x: 0, y: 0, width: 100, height: 50 })
      expect(rect.x).toBe(0)
      expect(rect.y).toBe(0)
      expect(rect.width).toBe(100)
      expect(rect.height).toBe(50)
    })

    it("contains method works correctly", () => {
      const rect = createRectangle({ x: 10, y: 10, width: 100, height: 50 })
      expect(rect.contains(50, 30)).toBe(true)
      expect(rect.contains(10, 10)).toBe(true)
      expect(rect.contains(5, 5)).toBe(false)
      expect(rect.contains(110, 60)).toBe(false)
    })

    it("rejects invalid dimensions via schema validation", () => {
      // createRectangle is a factory function that doesn't validate - use RectangleSchema for validation
      expect(() =>
        RectangleSchema.parse({ x: 0, y: 0, width: 0, height: 50 })
      ).toThrow()
      expect(() =>
        RectangleSchema.parse({ x: 0, y: 0, width: 100, height: -1 })
      ).toThrow()
    })
  })

  describe("SessionIndex", () => {
    it("creates empty session index", () => {
      const index = createEmptySessionIndex()
      expect(index.sessions).toEqual([])
      expect(index.activeSessionId).toBeNull()
    })
  })
})

describe("Schema Encoding/Decoding", () => {
  describe("SerializedSession", () => {
    it("decodes valid session JSON", () => {
      const json = {
        metadata: {
          id: "session-123",
          name: "Test Session",
          createdAt: 1704067200000,
          lastSwitchedAt: 1704067200000,
          autoNamed: false,
        },
        workspaces: [],
        activeWorkspaceId: 1,
      }

      const session = SerializedSessionSchema.parse(json)
      expect(session.metadata.id).toBe("session-123" as SessionId)
      expect(session.metadata.name).toBe("Test Session")
      expect(session.workspaces).toEqual([])
      expect(session.activeWorkspaceId).toBe(1 as WorkspaceId)
      expect(session.metadata.createdAt).toBe(1704067200000)
    })

    it("rejects invalid session JSON", () => {
      const json = { metadata: { id: "session-123" } } // Missing required fields
      expect(() =>
        SerializedSessionSchema.parse(json)
      ).toThrow()
    })
  })
})