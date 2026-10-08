import { useState, useEffect } from 'react';
import { getSkills } from '@/services/api';

interface Skill {
  name: string;
  description: string;
}

interface SkillsPanelProps {
  onToast: (type: string, message: string) => void;
}

export default function SkillsPanel({ onToast }: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSkills()
      .then((data) => setSkills(data.skills || []))
      .catch((err) => {
        console.error('Failed to load skills:', err);
        onToast('error', 'Failed to load skills');
      })
      .finally(() => setLoading(false));
  }, [onToast]);

  if (loading) {
    return (
      <div className="skills-loading">加载中...</div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="skills-empty">
        <p>暂无可用技能</p>
        <p className="skills-empty-hint">在 ~/.agent/skills/ 下添加 .md 文件即可创建技能</p>
      </div>
    );
  }

  return (
    <div className="skills-list">
      {skills.map((skill) => (
        <div key={skill.name} className="skill-card">
          <div className="skill-card-icon">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2L12 16.8 6 21.2l2.4-7.2-6-4.8h7.6z" fill="currentColor" opacity="0.7" />
            </svg>
          </div>
          <div className="skill-card-info">
            <div className="skill-card-name">{skill.name}</div>
            <div className="skill-card-desc">{skill.description}</div>
          </div>
          <div className="skill-card-hint">/{skill.name}</div>
        </div>
      ))}
    </div>
  );
}
