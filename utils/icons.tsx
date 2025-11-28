import React from 'react';

export const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'code': <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />,
  'book': <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />,
  'pen': <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  'calc': <rect x="4" y="2" width="16" height="20" rx="2" />,
  'atom': <path d="M12 2a10 10 0 1 0 10 10" />, // Simplified atom-like
  'globe': <circle cx="12" cy="12" r="10" />,
  'briefcase': <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />,
  'dumbbell': <path d="M6.5 6.5l11 11" />,
  'music': <path d="M9 18V5l12-2v13" />,
  'game': <rect x="2" y="6" width="20" height="12" rx="2" />,
  'bulb': <path d="M9 18h6" />, 
  'chess': <rect x="3" y="3" width="18" height="18" rx="2" />,
  'heart': <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  'money': <rect x="2" y="6" width="20" height="12" rx="2" />,
  'user': <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />,
  'video': <polygon points="23 7 16 12 23 17 23 7" />,
  'layers': <polygon points="12 2 2 7 12 12 22 7 12 2" />,
  'wrench': <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  'leaf': <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.5 2 6a7.23 7.23 0 0 1-1.3 4" />,
  'star': <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
};

export const getIcon = (key: string) => {
    const icon = CATEGORY_ICONS[key] || CATEGORY_ICONS['star'];
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {icon}
        </svg>
    );
};
