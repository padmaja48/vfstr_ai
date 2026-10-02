import { useContext, useMemo } from 'react';

import {

  adminAnalyticsService,

  adminInstitutionsService,

  adminInterviewsService,

  adminReportsService,

  adminResumesService,

  adminUsersService,

} from '../services/adminApi';

import {

  buildInstitutionsFromUsers,

  buildScoreDistribution,

  buildTopWeaknesses,

  buildWeeklyActivity,

  filterByRange,

  mergeInstitutionCatalog,

  monthUsageCount,

  buildAiInsights,

} from '../lib/aggregates';

import {

  mapInterview,

  mapResume,

  mapUserToPlatformAdmin,

  mapUserToStudent,

  skillsFromScores,

} from '../lib/mappers';

import { getAssignedInstitutions, isInstitutionAdmin, isSuperAdmin } from '../lib/adminAuth';

import { AuthContext } from '../../context/AuthContext';

import { useAdminQuery } from './useAdminQuery';



const idOfUser = (doc) => {

  if (!doc) return '';

  if (typeof doc === 'string') return doc;

  return String(doc._id || doc.id || '');

};



const metricsFromAnalytics = (analytics) => {

  if (!analytics) {

    return {

      totalStudents: 0,

      totalInterviews: 0,

      completedInterviews: 0,

      scheduledInterviews: 0,

      cancelledInterviews: 0,

      terminatedInterviews: 0,

      readiness: 0,

      highestScore: 0,

      lowestScore: 0,

      averageScore: 0,

      technicalAverage: 0,

      communicationAverage: 0,

    };

  }



  const { totals, scores } = analytics;

  return {

    totalStudents: totals?.students ?? 0,

    totalInterviews: totals?.interviews ?? 0,

    completedInterviews: totals?.completedInterviews ?? 0,

    scheduledInterviews: totals?.scheduledInterviews ?? 0,

    cancelledInterviews: totals?.cancelledInterviews ?? 0,

    terminatedInterviews: totals?.terminatedInterviews ?? 0,

    readiness: scores?.readinessScore ?? 0,

    highestScore: scores?.highest ?? 0,

    lowestScore: scores?.lowest ?? 0,

    averageScore: scores?.average ?? 0,

    technicalAverage: scores?.technicalAverage ?? 0,

    communicationAverage: scores?.communicationAverage ?? 0,

  };

};



export const useAdminUsers = (options = {}) => {

  const {

    paginated = false,

    page = 1,

    limit = 8,

    search = '',

    status = 'all',

    scope = 'all',

    institution = 'all',

    institutionId,

    batch = '',

    branch = '',

  } = options;

  const query = useAdminQuery(async () => {

    const listParams = {

      paginated,

      page,

      limit,

      search,

      status,

      scope,

      institution,

      institutionId,

      batch,

      branch,

    };

    const payload = await adminUsersService.list(listParams);

    const users = Array.isArray(payload) ? payload : (payload.users || []);

    const students = users

      .filter((u) => !['superAdmin', 'institutionAdmin', 'admin', 'recruiter'].includes(u.role))

      .map(mapUserToStudent);

    const platformAdmins = users

      .filter((u) => ['superAdmin', 'institutionAdmin', 'admin', 'recruiter'].includes(u.role))

      .map(mapUserToPlatformAdmin);

    return {

      users,

      students,

      platformAdmins,

      pagination: Array.isArray(payload) ? null : payload.pagination,

    };

  }, [paginated, page, limit, search, status, scope, institution, institutionId, batch, branch]);



  return {

    ...query,

    students: query.data?.students || [],

    platformAdmins: query.data?.platformAdmins || [],

    users: query.data?.users || [],

    pagination: query.data?.pagination || null,

  };

};



export const useAdminUserAnalytics = (userId) =>

  useAdminQuery(

    async () => {

      const payload = await adminUsersService.getAnalytics(userId);

      const student = payload.user ? mapUserToStudent(payload.user) : null;

      const history = (payload.interviewHistory || []).map((iv) => ({

        ...mapInterview(iv),

        studentId: student?.id || idOfUser(iv.userId),

        studentName: student?.name || 'Unknown',

        studentEmail: student?.email || '',

        institution: student?.institution || '',

      }));

      const latestScores = history[0]?.scores || {};

      return {

        user: student,

        interviewHistory: history,

        skillBreakdown: skillsFromScores(

          latestScores,

          payload.user?.averageScore || history[0]?.score || 40,

        ),

      };

    },

    [userId],

    { enabled: Boolean(userId) },

  );



export const useAdminInterviews = () => {

  const query = useAdminQuery(async () => {

    const rows = await adminInterviewsService.list();

    return rows.map(mapInterview);

  }, []);

  return { ...query, interviews: query.data || [] };

};



export const useAdminInterview = (id) =>

  useAdminQuery(

    async () => {

      const payload = await adminInterviewsService.get(id);

      return {

        interview: mapInterview(payload.interview || payload),

        report: payload.report || null,

      };

    },

    [id],

    { enabled: Boolean(id) },

  );



export const useAdminResumes = () => {

  const query = useAdminQuery(async () => {

    const rows = await adminResumesService.list();

    return rows.map(mapResume);

  }, []);

  return { ...query, resumes: query.data || [] };

};



export const useAdminResume = (id) =>

  useAdminQuery(

    async () => mapResume(await adminResumesService.get(id)),

    [id],

    { enabled: Boolean(id) },

  );



export const useAdminReports = () => {

  const query = useAdminQuery(async () => adminReportsService.list(), []);

  return { ...query, reports: query.data || [] };

};



/** Platform or institution analytics from the backend (single source of truth for counts/scores). */

export const useAdminAnalytics = (options = {}) => {

  const { user } = useContext(AuthContext);

  const superAdmin = isSuperAdmin(user);

  const institutionAdmin = isInstitutionAdmin(user);

  const { institutionId, institution, batch, branch, enabled = true } = options;



  const query = useAdminQuery(

    async () => {

      if (superAdmin && !institutionId && !institution) {

        return adminAnalyticsService.platformAnalytics();

      }

      return adminAnalyticsService.institutionAnalytics({

        institutionId: institutionId || undefined,

        institution: institution || undefined,

        batch: batch || undefined,

        branch: branch || undefined,

      });

    },

    [superAdmin, institutionAdmin, institutionId, institution, batch, branch],

    { enabled: enabled && (superAdmin || institutionAdmin) },

  );



  return {

    ...query,

    analytics: query.data,

    metrics: metricsFromAnalytics(query.data),

  };

};



/** Combined dashboard payload — analytics from API; charts from interview/resume lists. */

export const useAdminDashboard = (range = '30d', options = {}) => {

  const { user } = useContext(AuthContext);

  const superAdmin = isSuperAdmin(user);

  const institutionAdmin = isInstitutionAdmin(user);

  const { institutionId, institution } = options;



  const analyticsQ = useAdminAnalytics({ institutionId, institution });

  const interviewsQ = useAdminInterviews();

  const resumesQ = useAdminResumes();

  const catalogQ = useAdminInstitutionCatalog();



  const loading = analyticsQ.loading || interviewsQ.loading || resumesQ.loading

    || (superAdmin && catalogQ.loading);

  const error = analyticsQ.error || interviewsQ.error || resumesQ.error

    || (superAdmin ? catalogQ.error : null);



  const derived = useMemo(() => {

    const interviews = interviewsQ.interviews;

    const resumes = resumesQ.resumes;

    const ranged = filterByRange(interviews, range, 'date');

    const analyticsMetrics = metricsFromAnalytics(analyticsQ.analytics);



    const institutions = superAdmin

      ? mergeInstitutionCatalog(

        catalogQ.catalog,

        buildInstitutionsFromUsers([], interviews),

      )

      : [];



    return {

      interviews: ranged,

      allInterviews: interviews,

      resumes,

      institutions,

      analytics: analyticsQ.analytics,

      metrics: {

        ...analyticsMetrics,

        activeInstitutions: superAdmin

          ? institutions.filter((i) => i.studentCount > 0 && i.name !== 'Unassigned').length

            || institutions.filter((i) => i.studentCount > 0).length

          : 1,

        aiUsage: monthUsageCount(interviews, resumes),

      },

      activityData: buildWeeklyActivity(interviews),

      scoreData: buildScoreDistribution(ranged),

      weaknessData: buildTopWeaknesses(ranged, 6).map((w) => ({

        label: w.label.length > 34 ? `${w.label.slice(0, 34)}…` : w.label,

        fullLabel: w.label,

        count: w.count,

      })),

      recentInterviews: [...interviews]

        .sort((a, b) => new Date(b.date) - new Date(a.date))

        .slice(0, 8),

      topInstitutions: superAdmin

        ? [...institutions]

          .sort((a, b) => b.placementReadinessPct - a.placementReadinessPct)

          .slice(0, 6)

        : [],

      insights: buildAiInsights({

        students: [],

        interviews,

        institutions,

        metrics: analyticsMetrics,

      }),

    };

  }, [

    analyticsQ.analytics,

    interviewsQ.interviews,

    resumesQ.resumes,

    catalogQ.catalog,

    range,

    superAdmin,

  ]);



  return {

    loading,

    error,

    isSuperAdmin: superAdmin,

    isInstitutionAdmin: institutionAdmin,

    refetch: async () => {

      await Promise.all([

        analyticsQ.refetch(),

        interviewsQ.refetch(),

        resumesQ.refetch(),

        ...(superAdmin ? [catalogQ.refetch()] : []),

      ]);

    },

    ...derived,

  };

};



export const useAdminInstitutionCatalog = (options = {}) => {

  const { enabled = true } = options;

  const { user } = useContext(AuthContext);

  const shouldFetch = enabled && isSuperAdmin(user);

  const query = useAdminQuery(

    async () => adminInstitutionsService.list(),

    [shouldFetch],

    { enabled: shouldFetch },

  );

  return { ...query, catalog: query.data || [] };

};



export const useAdminInstitutionsDerived = () => {

  const { user } = useContext(AuthContext);

  const superAdmin = isSuperAdmin(user);

  const collegeAdmin = isInstitutionAdmin(user);

  const assignedInstitutions = useMemo(() => getAssignedInstitutions(user), [user]);

  const usersQ = useAdminUsers();

  const interviewsQ = useAdminInterviews();

  const catalogQ = useAdminInstitutionCatalog();

  const loading = usersQ.loading || interviewsQ.loading || (superAdmin && catalogQ.loading);

  const error = usersQ.error || interviewsQ.error || (superAdmin ? catalogQ.error : null);



  const institutions = useMemo(

    () => {

      const derived = mergeInstitutionCatalog(

        superAdmin ? catalogQ.catalog : assignedInstitutions,

        buildInstitutionsFromUsers(usersQ.students, interviewsQ.interviews),

      );

      if (collegeAdmin && assignedInstitutions.length) {

        const allowedIds = new Set(assignedInstitutions.map((i) => String(i.id)));

        const allowedNames = new Set(assignedInstitutions.map((i) => String(i.name || '').toLowerCase()));

        return derived.filter((row) => allowedIds.has(String(row.id))

          || allowedNames.has(String(row.name || '').toLowerCase()));

      }

      return derived;

    },

    [catalogQ.catalog, usersQ.students, interviewsQ.interviews, superAdmin, collegeAdmin, assignedInstitutions],

  );



  return {

    loading,

    error,

    institutions,

    catalog: catalogQ.catalog,

    students: usersQ.students,

    interviews: interviewsQ.interviews,

    refetch: async () => {

      await Promise.all([

        usersQ.refetch(),

        interviewsQ.refetch(),

        ...(superAdmin ? [catalogQ.refetch()] : []),

      ]);

    },

  };

};



export { useAdminQuery };


