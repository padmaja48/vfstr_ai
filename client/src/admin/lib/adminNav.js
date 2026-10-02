import {

  LayoutDashboard,

  Users,

  Mic2,

  Library,

  FileSearch,

  LineChart,

  Building2,

  Settings,

} from 'lucide-react';

import { isSuperAdmin } from './adminAuth';



const ALL_NAV = [

  { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true, section: 'Overview', tiers: ['superAdmin', 'admin'] },

  { path: '/admin/users', label: 'Students', icon: Users, section: 'People', tiers: ['superAdmin', 'admin'] },

  { path: '/admin/interviews', label: 'Interviews', icon: Mic2, section: 'People', tiers: ['superAdmin', 'admin'] },

  { path: '/admin/resume-analysis', label: 'Resume Analysis', icon: FileSearch, section: 'Content', tiers: ['superAdmin', 'admin'] },

  { path: '/admin/performance', label: 'Performance', icon: LineChart, section: 'Insights', tiers: ['superAdmin', 'admin'] },

  { path: '/admin/institutions', label: 'Institutions', icon: Building2, section: 'Insights', tiers: ['superAdmin'] },

  { path: '/admin/question-bank', label: 'Question Bank', icon: Library, section: 'Content', tiers: ['superAdmin'] },

  { path: '/admin/settings', label: 'Settings', icon: Settings, section: 'Platform', tiers: ['superAdmin'] },

];



export const getAdminNavForUser = (user) => {

  const tier = isSuperAdmin(user) ? 'superAdmin' : 'admin';

  return ALL_NAV.filter((item) => item.tiers.includes(tier));

};



/** Group nav items by section label for sidebar rendering. */

export const getAdminNavSections = (user) => {

  const nav = getAdminNavForUser(user);

  const sections = [];

  const seen = new Map();

  nav.forEach((item) => {

    const key = item.section || 'General';

    if (!seen.has(key)) {

      const group = { title: key, items: [] };

      seen.set(key, group);

      sections.push(group);

    }

    seen.get(key).items.push(item);

  });

  return sections;

};



/** @deprecated use getAdminNavForUser */

export const ADMIN_NAV = ALL_NAV;

