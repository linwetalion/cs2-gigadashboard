import "dotenv/config";
import { seedDemo } from "./demo.js";

const result = seedDemo();
console.log(`Seeded ${result.matches} matches and ${result.metrics} metric values.`);
