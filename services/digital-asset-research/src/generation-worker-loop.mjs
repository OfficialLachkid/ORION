import { runResearchGenerationJob } from './generation-jobs.mjs';

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function runResearchGenerationWorker(options) {
  const runJob = options.runJob || runResearchGenerationJob;
  const sleep = options.sleep || wait;
  let resourceWaitCycles = 0;
  while (true) {
    try {
      const result = await runJob(options);
      return { ...result, resource_wait_cycles: resourceWaitCycles };
    } catch (error) {
      if (error?.code !== 'RESEARCH_GENERATION_RESOURCE_BUSY') throw error;
      resourceWaitCycles += 1;
      await sleep(Math.max(0, Number(error.retryAfterMs) || 30_000));
    }
  }
}
