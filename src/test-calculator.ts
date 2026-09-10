import { add, multiply } from "./sample-calculator.js";

console.log("Testing calculator...");
const sum = add(2, 3);
if (sum !== 5) throw new Error(`add(2, 3) expected 5, got ${sum}`);

const product = multiply(3, 4);
if (product !== 12) throw new Error(`multiply(3, 4) expected 12, got ${product}`);

console.log("🎉 All calculator tests passed!");
