// Generic example defaults. Personal goals and health records do not belong in Git.
export default {
  profile: {
    name: '',
    partner: 'my partner',
    season: 'Build a healthy, unhurried life.',
    healthDefault: 'Choose one small act of care that fits today.',
    connectionDefault: 'Make room for a few unhurried minutes with someone you care about.',
    values: ['Health', 'Connection', 'Presence', 'Curiosity']
  },
  goals: [
    {id:'example-learning',title:'Make room for something I enjoy learning',why:'An example to edit, park, or delete.',nextAction:'Choose one small topic to explore.',minutes:10,effort:'light',status:'parked',deadline:'',source:'suggested'},
    {id:'example-home',title:'Make everyday life easier',why:'An example to edit, park, or delete.',nextAction:'Name one recurring frustration I could simplify.',minutes:10,effort:'light',status:'parked',deadline:'',source:'suggested'}
  ]
};
