import { threeContextEvaluationCli } from '../server/three-context-evaluation.ts';
console.log(JSON.stringify(threeContextEvaluationCli(process.argv.slice(2)), null, 2));
