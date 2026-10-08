import { describe, expect, it } from 'vitest';
import { normalizeGraphRelation, getGraphRelationPriority } from '../graphOntology.js';

describe('graphOntology', () => {
  describe('normalizeGraphRelation', () => {
    it('returns known canonical relations as-is', () => {
      expect(normalizeGraphRelation('包含')).toBe('包含');
      expect(normalizeGraphRelation('属于')).toBe('属于');
      expect(normalizeGraphRelation('基于')).toBe('基于');
      expect(normalizeGraphRelation('references')).toBe('references');
    });

    it('normalizes synonyms', () => {
      expect(normalizeGraphRelation('组成部分')).toBe('包含');
      expect(normalizeGraphRelation('包括')).toBe('包含');
      expect(normalizeGraphRelation('依赖于')).toBe('基于');
      expect(normalizeGraphRelation('演变为')).toBe('演进到');
      expect(normalizeGraphRelation('起源于')).toBe('演化自');
      expect(normalizeGraphRelation('不同于')).toBe('区别于');
      expect(normalizeGraphRelation('引发')).toBe('导致');
      expect(normalizeGraphRelation('解决')).toBe('应对');
      expect(normalizeGraphRelation('用于')).toBe('应用于');
      expect(normalizeGraphRelation('限制')).toBe('约束');
      expect(normalizeGraphRelation('实例')).toBe('案例');
    });

    it('returns null for unknown relations', () => {
      expect(normalizeGraphRelation('未知关系')).toBeNull();
      expect(normalizeGraphRelation('')).toBeNull();
    });

    it('trims whitespace', () => {
      expect(normalizeGraphRelation(' 包含 ')).toBe('包含');
    });
  });

  describe('getGraphRelationPriority', () => {
    it('returns highest priority for 包含/属于', () => {
      expect(getGraphRelationPriority('包含')).toBe(100);
      expect(getGraphRelationPriority('属于')).toBe(100);
    });

    it('returns medium priority', () => {
      expect(getGraphRelationPriority('基于')).toBe(85);
      expect(getGraphRelationPriority('应用于')).toBe(85);
    });

    it('returns lowest for references', () => {
      expect(getGraphRelationPriority('references')).toBe(0);
    });

    it('returns undefined for unknown', () => {
      expect(getGraphRelationPriority('unknown' as any)).toBeUndefined();
    });
  });
});
