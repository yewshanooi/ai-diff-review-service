import { ReviewProvider } from '../types';
import { mockProvider } from './mock';
import { llmProvider } from './llm';

const providers: Record<string, ReviewProvider> = {
  mock: mockProvider,
  llm: llmProvider,
};

export function getProvider(name: string): ReviewProvider | undefined {
  return providers[name];
}
