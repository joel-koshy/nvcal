import { Hono } from "hono";
import eventsRouter from "./events";
import type { Bindings } from "hono/types";
import syncRouter from "./sync";
const apiRouter = new Hono<{ Bindings: Bindings }>();
apiRouter.route('/events', eventsRouter)
apiRouter.route('/sync', syncRouter)

export default apiRouter;


