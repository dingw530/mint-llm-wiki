import { callEndpoint } from '../api/_base';

export function getSkills(): Promise<{ skills: { name: string; description: string }[] }> {
  return callEndpoint('skills:list');
}
