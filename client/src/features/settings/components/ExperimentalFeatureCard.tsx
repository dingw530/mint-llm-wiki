import type { ReactNode } from 'react';

interface ExperimentalFeatureCardProps {
  index: string;
  title: string;
  description: string;
  badge?: string;
  className?: string;
  children: ReactNode;
}

/**
 * 统一承载实验性功能的标题、状态和内容布局。
 * @param props 实验功能卡片配置
 * @returns 统一样式的实验功能卡片
 */
export default function ExperimentalFeatureCard({
  index,
  title,
  description,
  badge = '实验性',
  className = '',
  children,
}: ExperimentalFeatureCardProps) {
  return (
    <section className={`experimental-feature-card ${className}`.trim()}>
      <header className="experimental-feature-header">
        <div>
          <div className="experimental-feature-eyebrow">EXPERIMENTAL / {index}</div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <span className="experimental-feature-badge">{badge}</span>
      </header>
      <div className="experimental-feature-content">{children}</div>
    </section>
  );
}
