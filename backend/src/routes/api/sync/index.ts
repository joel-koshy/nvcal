import { Hono } from "hono";
import type { Bindings } from "../../../types";
import googleSyncRouter from "./google";

const syncRouter = new Hono<{ Bindings: Bindings }>();
syncRouter.route('/google', googleSyncRouter)



export default syncRouter

