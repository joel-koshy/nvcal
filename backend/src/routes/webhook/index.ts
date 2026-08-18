import { Hono } from "hono";
import type { Bindings } from "../../types";

import googleWebHookRouter from "./google";

const webHookRouter = new Hono<{ Bindings: Bindings }>();
webHookRouter.route('/google', googleWebHookRouter)



export default webHookRouter

