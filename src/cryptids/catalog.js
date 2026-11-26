// Registers the shared framework's brains, body models and every species profile (#86).
// A new cryptid needs only a profile entry in profiles.js (data) — it's registered here
// automatically and runs on the shared CryptidAI + utility brain unless it names its own.
import { registerBrain, registerModel, registerSpecies } from './species.js';
import { utilityBrain } from './brains/utilityBrain.js';
import { genericBrain } from './brains/genericBrain.js';
import { bigfootBrain } from './brains/bigfootBrain.js';
import { buildBigfootModel } from './bigfootModel.js';
import { PROFILES } from './profiles.js';

registerBrain('utility', utilityBrain);
registerBrain('generic', genericBrain);      // the older fixed-priority tree, kept for comparison
registerBrain('bigfoot', bigfootBrain);      // Bigfoot's signature warn-and-charge rules
registerModel('bigfoot', buildBigfootModel);
for (const p of Object.values(PROFILES)) if (p.id !== 'unknown') registerSpecies(p);
