// Route catalogue and capability checks shared by navigation and search.
export const pages = ['space-map','avatar-studio','getting-started','system-health','shop','cart','orders','order-desk','shop-admin','role-updates','classroom','meeting-room','project-board','home','about','founders','investors','investor-portal','admin','privacy','application','applications','moderation','notifications','members','messages','feed','channels','library','news','projects','inventory','finance','finance-review','finance-reports','officers','office','discussions','courses','teaching','events','calendar','announcements','founder-room'];
export const workspacePageInfo={
  'space-map':{title:'SPACE Map',section:'Community',aliases:'Location people places meetups sharing ghost mode'},
  'avatar-studio':{title:'Avatar studio',section:'Your workspace',aliases:'Character clothing outfit style wardrobe'},
  'getting-started':{title:'Getting started',section:'Your workspace',aliases:'Welcome checklist onboarding teacher setup'},
  'system-health':{title:'System health',section:'Administration',aliases:'Email delivery push notifications upload failures diagnostics'},
  shop:{title:'Store / View products',section:'Club shop',aliases:'Buy merchandise T-shirts electronics kits'},
  cart:{title:'Basket',section:'Club shop'},
  orders:{title:'My orders',section:'Club shop',aliases:'Collection purchases order tracking'},
  'order-desk':{title:'Orders & fulfilment',section:'Administration',aliases:'Incoming purchases process orders ready delivered receipts'},
  'shop-admin':{title:'Manage shop',section:'Administration',aliases:'Products sale stock prices orders'},
  'role-updates':{title:'Role updates',section:'Your workspace',aliases:'Assignment notes acknowledge responsibilities'},
  classroom:{title:'Classrooms',section:'Learning & projects',aliases:'Lessons attendance gradebook certificates'},
  'meeting-room':{title:'Meetings & actions',section:'Club activities',aliases:'Secretary minutes agenda attendance'},
  'project-board':{title:'Project workspace',section:'Learning & projects',aliases:'Kanban board progress evidence'},
  home:{title:'Home',section:'Your workspace'},
  about:{title:'About the club',section:'About SPACE'},
  founders:{title:'Club leadership',section:'About SPACE',aliases:'Founders founding team'},
  investors:{title:'Investors & partners',section:'Leadership & partners'},
  'investor-portal':{title:'Investor portal',section:'Leadership & partners'},
  admin:{title:'Admin overview',section:'Administration',aliases:'Admin dashboard club oversight'},
  privacy:{title:'Privacy & conduct',section:'About SPACE'},
  application:{title:'My application',section:'Your workspace'},
  applications:{title:'Membership approvals',section:'Administration',aliases:'Applications new accounts'},
  moderation:{title:'Moderation',section:'Administration'},
  notifications:{title:'Notifications',section:'Your workspace',aliases:'Inbox alerts mentions replies'},
  members:{title:'Members',section:'Community',aliases:'Profiles people'},
  messages:{title:'Direct messages',section:'Your workspace',aliases:'Messages DM private chat'},
  feed:{title:'Member feed',section:'Community',aliases:'Activity feed posts'},
  channels:{title:'Team chat',section:'Community',aliases:'Channels group chat'},
  library:{title:'Shared files',section:'Learning & projects',aliases:'Document library resources'},
  news:{title:'Technology news',section:'Community'},
  projects:{title:'Projects',section:'Learning & projects'},
  inventory:{title:'Inventory',section:'Club activities'},
  finance:{title:'Finance',section:'Administration'},
  officers:{title:'Roles & offices',section:'Administration',aliases:'Assign officers secretary treasurer leadership'},
  office:{title:'My office',section:'Your workspace',aliases:'Officer duties tasks minutes secretary treasurer'},
  'finance-reports':{title:'Finance reports',section:'Club activities',aliases:'Treasurer monthly reports'},
  'finance-review':{title:'Finance approvals',section:'Leadership & partners',aliases:'Finance review'},
  discussions:{title:'Discussion forum',section:'Community',aliases:'Discussions questions ideas'},
  courses:{title:'My learning',section:'Learning & projects',aliases:'Courses workshops enrolled classes'},
  teaching:{title:'Teaching studio',section:'Learning & projects',aliases:'Teachers students reviews'},
  events:{title:'Events',section:'Club activities'},
  calendar:{title:'Calendar',section:'Your workspace'},
  announcements:{title:'Announcements',section:'Club activities',aliases:'Club alerts notices'},
  'founder-room':{title:'Founder meetings',section:'Leadership & partners',aliases:'Founder room'}
};

export function canOpenWorkspacePage(target,c){
 if(target==='system-health')return c.admin;
 if(['getting-started','role-updates','notifications'].includes(target))return c.approved;
 if(['shop-admin','order-desk','officers','admin','applications','moderation','finance'].includes(target))return c.admin;
 if(target==='application')return c.signedIn&&!c.approved;
 if(target==='teaching')return c.teacher;
 if(['founder-room','investors'].includes(target))return c.founder;
 if(target==='finance-review')return false;
 if(target==='office')return c.officer;
 if(target==='finance-reports')return c.financeReport;
 if(target==='investor-portal')return c.investor||c.admin;
 if(['home','about','founders','privacy'].includes(target))return true;
 return pages.includes(target)&&c.club;
}
