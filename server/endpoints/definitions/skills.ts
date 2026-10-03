import { listSkills } from '../../domains/skills/index.js';
import type { EndpointDescriptor } from '../types.js';

export const skillsEndpoints: EndpointDescriptor[] = [
  {
    id: 'skills:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getSkills',
    service: async () => {
      const skills = await listSkills();
      return { skills: skills.map((s) => ({ name: s.name, description: s.description })) };
    },
    result: 'direct',
    async: true,
  },
];
