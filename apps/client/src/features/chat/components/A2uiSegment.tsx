import { useEffect, useMemo, useRef, useState } from 'react';
import { A2uiSurface } from '@a2ui/react/v0_9';
import type { A2uiSegment as A2uiSegmentData } from '@/types';
import { createA2uiProcessor, getSourceSnippet, parseA2uiMessage, type A2uiSurfaceModel } from './a2uiProtocol';
import { mintCatalog } from './IngestionTaskCards';

/** 渲染一段回答中的 A2UI 消息；处理失败时不影响旁边的文本答案。 */
export default function A2uiSegment({ segment }: { segment: A2uiSegmentData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showFallback, setShowFallback] = useState(true);
  const processor = useMemo(() => {
    const current = createA2uiProcessor(mintCatalog);
    for (const raw of segment.messages) {
      const message = parseA2uiMessage(JSON.stringify(raw));
      if (!message) {
        console.warn('[a2ui] failed to parse answer message', raw);
        continue;
      }
      try {
        current.processMessages([message]);
      } catch (error) {
        console.warn('[a2ui] ignored invalid answer message', error);
      }
    }
    return current;
  }, [segment.messages]);

  const surfaces = Array.from(processor.model.surfacesMap.values()) as A2uiSurfaceModel[];
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const rendered = containerRef.current?.querySelector('[data-a2ui-surface] .source-reference-card');
      setShowFallback(!rendered);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [segment.messages]);

  return (
    <div className="a2ui-answer-segment" ref={containerRef}>
      <div className="a2ui-source-group">
      {surfaces.map((surface) => {
        const source = surface.dataModel.get('/source');
        const sourceSnippet = getSourceSnippet(source);
        return (
          <div key={surface.id}>
            <div data-a2ui-surface="true"><A2uiSurface surface={surface} /></div>
            {showFallback && source && typeof source === 'object' && !Array.isArray(source) && 'title' in source && (
              <div className="source-reference-card" data-a2ui-fallback="true" aria-label="回答来源">
                <span className="source-reference-card-label">[{String('refId' in source ? source.refId : '')}]</span>
                <span className="source-reference-card-body">
                  <strong className="source-reference-card-title">{String(source.title)}</strong>
                  {'heading' in source && source.heading && <span className="source-reference-card-heading">{String(source.heading)}</span>}
                  {sourceSnippet && <span className="source-reference-card-snippet">{sourceSnippet}</span>}
                  {'file' in source && source.file !== source.title && <span className="source-reference-card-footer"><span className="source-reference-card-file">{String(source.file)}</span></span>}
                </span>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
