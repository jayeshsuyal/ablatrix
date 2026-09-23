import type { ResearchConfig } from './config.ts';
import type { ResearchInput, ResearchOutput } from './contracts.ts';

export type ChargeEvidence = { cents: number; reference: string };
export function validatedCharge(charge: ChargeEvidence): ChargeEvidence {
  if (!charge || !Number.isSafeInteger(charge.cents) || charge.cents < 0 ||
      typeof charge.reference !== 'string' || !charge.reference.trim()) {
    throw new Error('Provider charge evidence is missing or invalid.');
  }
  return charge;
}
export type Readiness = {
  ready: boolean; reason: string; approvedCapCents: number;
  maxResearchCents: number; maxProposalCents: number;
  remoteCapEvidence: string | null;
};
export interface MeteredLiveProvider {
  readiness(): Readiness;
  research(input: ResearchInput, attemptId: string, settings: ResearchConfig): Promise<{
    status: 'completed' | 'failed'; output: ResearchOutput | null; error: string | null;
    charge: ChargeEvidence; executionId: string; model: string | null;
    agentVersion: string | null; usage: Record<string, unknown> | null;
  }>;
  propose(investigation: string, attemptId: string): Promise<{
    settings: ResearchConfig; charge: ChargeEvidence; model: string | null;
    requestId: string | null; usage: Record<string, unknown> | null;
  }>;
}

export class SapiomLiveProvider implements MeteredLiveProvider {
  readiness(): Readiness {
    return {
      ready: false,
      reason: 'Sapiom agents.run and Router currently expose no verified whole-call dollar charge and no programmatically verified remote cap to this app.',
      approvedCapCents: 0, maxResearchCents: 0, maxProposalCents: 0,
      remoteCapEvidence: null
    };
  }
  async research(): Promise<never> { throw new Error(this.readiness().reason); }
  async propose(): Promise<never> { throw new Error(this.readiness().reason); }
}
