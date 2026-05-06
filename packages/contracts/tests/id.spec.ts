import { describe, expect, it } from "vitest";
import { newId } from "../src/index";
describe("newId",()=>{it("uses prefixes",()=>{const id=newId("agt_"); expect(id.startsWith("agt_")).toBe(true); expect(id.length).toBe(25);});});
