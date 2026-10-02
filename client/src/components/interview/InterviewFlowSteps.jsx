import React from 'react';

export const INTERVIEW_FLOW_STEPS = [
  'Resume Upload',
  'Interview Setup',
  'VFSTR.AI Interview',
  'Scorecard Report',
];

export const InterviewFlowSteps = ({
  steps = INTERVIEW_FLOW_STEPS,
  activeIndex = 0,
  compact = false,
  className = '',
}) => (
  <div className={`flow-steps${compact ? ' flow-steps--compact' : ''}${className ? ` ${className}` : ''}`}>
    {steps.map((step, index) => (
      <div
        key={step}
        className={`flow-step${index < activeIndex ? ' flow-step--done' : ''}${index === activeIndex ? ' flow-step--active' : ''}`}
      >
        <span className="flow-step-index">{index + 1}</span>
        <span className="flow-step-label">{step}</span>
      </div>
    ))}
  </div>
);

export default InterviewFlowSteps;
