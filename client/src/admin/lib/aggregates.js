/** Client-side aggregations over real fetched admin data. */

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const filterByRange = (items, range, dateKey = 'date') => {
  if (!range || range === 'all') return items;
  const now = startOfDay(new Date());
  let from = null;
  if (range === 'today') from = now;
  else if (range === '7d') {
    from = new Date(now);
    from.setDate(from.getDate() - 6);
  } else if (range === '30d') {
    from = new Date(now);
    from.setDate(from.getDate() - 29);
  }
  if (!from) return items;
  return items.filter((item) => {
    const raw = item[dateKey];
    if (!raw) return false;
    return new Date(raw) >= from;
  });
};

export const buildWeeklyActivity = (interviews, weeks = 8) => {
  const buckets = [];
  const now = startOfDay(new Date());
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const end = new Date(now);
    end.setDate(end.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    buckets.push({
      weekLabel: start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      start,
      end,
      interviewCount: 0,
      completedCount: 0,
    });
  }

  interviews.forEach((iv) => {
    const d = new Date(iv.date);
    const bucket = buckets.find((b) => d >= b.start && d <= new Date(b.end.getTime() + 86400000 - 1));
    if (!bucket) return;
    bucket.interviewCount += 1;
    if (iv.status === 'completed' || iv.rawStatus === 'Completed') bucket.completedCount += 1;
  });

  return buckets.map(({ weekLabel, interviewCount, completedCount }) => ({
    weekLabel,
    interviewCount,
    completedCount,
  }));
};

export const buildScoreDistribution = (interviews) => {
  const buckets = [
    { label: '0–49', min: 0, max: 49, count: 0 },
    { label: '50–64', min: 50, max: 64, count: 0 },
    { label: '65–79', min: 65, max: 79, count: 0 },
    { label: '80–89', min: 80, max: 89, count: 0 },
    { label: '90–100', min: 90, max: 100, count: 0 },
  ];
  interviews
    .filter((iv) => iv.status === 'completed' || iv.rawStatus === 'Completed')
    .forEach((iv) => {
      const score = Number(iv.score) || 0;
      const bucket = buckets.find((b) => score >= b.min && score <= b.max);
      if (bucket) bucket.count += 1;
    });
  return buckets;
};

export const buildTopWeaknesses = (interviews, limit = 8) => {
  const counts = new Map();
  interviews.forEach((iv) => {
    (iv.aiFeedback?.improvements || []).forEach((text) => {
      const label = String(text || '').trim();
      if (!label) return;
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

/**
 * Derive institution rows from user.institution free-text + interview rollups.
 * Contact email is unavailable without a dedicated Institutions API.
 */
export const buildInstitutionsFromUsers = (students, interviews) => {
  const map = new Map();

  const ensure = (name) => {
    const key = name || 'Unassigned';
    if (!map.has(key)) {
      map.set(key, {
        id: `inst-${encodeURIComponent(key.toLowerCase())}`,
        name: key,
        contactEmail: '',
        studentCount: 0,
        interviewCount: 0,
        scores: [],
        placementReadinessPct: 0,
        averageScore: 0,
        createdAt: null,
        pendingFields: ['contactEmail', 'CRUD'],
      });
    }
    return map.get(key);
  };

  students.forEach((s) => {
    const row = ensure(s.institution || 'Unassigned');
    row.studentCount += 1;
    if (s.createdAt && (!row.createdAt || new Date(s.createdAt) < new Date(row.createdAt))) {
      row.createdAt = s.createdAt;
    }
    if (Number.isFinite(Number(s.averageScore)) && Number(s.averageScore) > 0) {
      row.scores.push(Number(s.averageScore));
    }
  });

  interviews.forEach((iv) => {
    const name = iv.institution || students.find((s) => s.id === iv.studentId)?.institution || 'Unassigned';
    const row = ensure(name);
    row.interviewCount += 1;
    if (Number.isFinite(Number(iv.score)) && Number(iv.score) > 0) {
      row.scores.push(Number(iv.score));
    }
  });

  return [...map.values()]
    .map((row) => {
      const averageScore = Math.round(avg(row.scores) * 10) / 10;
      return {
        ...row,
        averageScore,
        placementReadinessPct: Math.round(averageScore),
        scores: undefined,
      };
    })
    .sort((a, b) => b.studentCount - a.studentCount);
};

/**
 * Merge persisted Institution catalog with rollups derived from users/interviews.
 * Catalog entries appear even with 0 students; live stats win when names match.
 */
export const mergeInstitutionCatalog = (catalog = [], derived = []) => {
  const map = new Map();

  derived.forEach((row) => {
    const key = String(row.name || '').trim().toLowerCase();
    if (!key) return;
    map.set(key, { ...row, fromCatalog: false });
  });

  catalog.forEach((c) => {
    const name = String(c.name || '').trim();
    const key = name.toLowerCase();
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      map.set(key, {
        ...existing,
        id: c.id || existing.id,
        catalogId: c.id,
        contactEmail: c.contactEmail || existing.contactEmail || '',
        fromCatalog: true,
        pendingFields: [],
      });
    } else {
      map.set(key, {
        id: c.id,
        catalogId: c.id,
        name,
        contactEmail: c.contactEmail || '',
        studentCount: 0,
        interviewCount: 0,
        averageScore: 0,
        placementReadinessPct: 0,
        createdAt: c.createdAt || null,
        fromCatalog: true,
        pendingFields: [],
      });
    }
  });

  return [...map.values()].sort((a, b) => {
    if (b.studentCount !== a.studentCount) return b.studentCount - a.studentCount;
    return String(a.name).localeCompare(String(b.name));
  });
};

export const buildCompanyPerformance = (interviews) => {
  const map = new Map();
  interviews.forEach((iv) => {
    const key = iv.targetCompany || '—';
    if (!map.has(key)) {
      map.set(key, { company: key, interviewCount: 0, scores: [], types: new Map() });
    }
    const row = map.get(key);
    row.interviewCount += 1;
    if (Number.isFinite(Number(iv.score))) row.scores.push(Number(iv.score));
    row.types.set(iv.type, (row.types.get(iv.type) || 0) + 1);
  });
  return [...map.values()]
    .map((row) => ({
      company: row.company,
      interviewCount: row.interviewCount,
      averageScore: Math.round(avg(row.scores) * 10) / 10,
      topType: [...row.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    }))
    .sort((a, b) => b.interviewCount - a.interviewCount);
};

export const buildStudentScoreTrend = (interviews, studentId) =>
  interviews
    .filter((iv) => iv.studentId === studentId && (iv.status === 'completed' || iv.rawStatus === 'Completed'))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((iv) => ({
      date: iv.date,
      label: new Date(iv.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      score: Number(iv.score) || 0,
    }));

export const buildAiInsights = ({ students, interviews, institutions }) => {
  const insights = [];
  const completed = interviews.filter((i) => i.status === 'completed' || i.rawStatus === 'Completed');
  const live = interviews.filter((i) => i.status === 'live');
  const flagged = interviews.filter((i) => i.status === 'flagged');
  const avgScore = Math.round(avg(completed.map((i) => Number(i.score) || 0)));

  insights.push(
    `${students.length} registered users · ${interviews.length} interviews · ${completed.length} completed (avg score ${avgScore || 0}).`,
  );
  if (live.length) {
    insights.push(`${live.length} interview${live.length === 1 ? '' : 's'} currently in progress.`);
  }
  if (flagged.length) {
    insights.push(`${flagged.length} session${flagged.length === 1 ? '' : 's'} flagged (violations or pending review).`);
  }
  const topInst = [...institutions].sort((a, b) => b.placementReadinessPct - a.placementReadinessPct)[0];
  if (topInst && topInst.name !== 'Unassigned') {
    insights.push(`Highest readiness cluster: ${topInst.name} (${topInst.placementReadinessPct}%).`);
  }
  const weaknesses = buildTopWeaknesses(interviews, 1);
  if (weaknesses[0]) {
    insights.push(`Most cited improvement: “${weaknesses[0].label}” (${weaknesses[0].count} mentions).`);
  }
  if (insights.length < 2) {
    insights.push('More AI insights will appear as interviews complete across VFSTR.AI.');
  }
  return insights.slice(0, 4);
};

export const monthUsageCount = (interviews, resumes) => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const inMonth = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === y && d.getMonth() === m;
  };
  return interviews.filter((i) => inMonth(i.date)).length
    + resumes.filter((r) => inMonth(r.uploadedAt)).length;
};
