// App-layer API contract maps. The web holds no copies of domain shapes; the
// route maps reference @nvcal/domain types directly. Consumers import the
// top-level ApiRoute / ApiResponse surface.

export type { EventRoute } from "./events";
export type { AuthRoute } from "./auth";

import type { EventRoute } from "./events";
import type { AuthRoute } from "./auth";

/** Mapping of every API route to its return type. */
export interface ApiRoute extends EventRoute, AuthRoute {}

/** Infer a route's response type from its route key. */
export type ApiResponse<R extends keyof ApiRoute> = ApiRoute[R];