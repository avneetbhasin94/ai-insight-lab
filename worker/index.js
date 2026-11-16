import { createApplication } from '../server/application.mjs';
import assets from 'fanform:assets';
const application = createApplication({ assets });
export default { fetch(request, env) { return application.fetch(request, env); } };
