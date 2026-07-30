import { createRouter, authedQuery } from "./middleware";
import { getPositions, getStatus } from "./telematics";

export const telematicsRouter = createRouter({
  /** Poller health for the Settings → Telematics card. */
  status: authedQuery.query(() => getStatus()),

  /** Latest real-GPS fixes for mapped vehicles (last-good cache). */
  positions: authedQuery.query(() => getPositions()),
});
