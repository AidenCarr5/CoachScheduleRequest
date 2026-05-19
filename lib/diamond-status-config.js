const editableDiamondStatusTargets = [
  {
    id: 'turtle-1',
    group: 'Turtle Club Diamonds',
    diamond: '1',
    label: 'Turtle Club Diamond #1',
    aliases: ['turtle club diamond #1', 'diamond #1', 'diamond 1', 'tc 1']
  },
  {
    id: 'turtle-2',
    group: 'Turtle Club Diamonds',
    diamond: '2',
    label: 'Turtle Club Diamond #2',
    aliases: ['turtle club diamond #2', 'diamond #2', 'diamond 2', 'tc 2']
  },
  {
    id: 'turtle-3',
    group: 'Turtle Club Diamonds',
    diamond: '3',
    label: 'Turtle Club Diamond #3',
    aliases: ['turtle club diamond #3', 'diamond #3', 'diamond 3', 'tc 3']
  },
  {
    id: 'turtle-4',
    group: 'Turtle Club Diamonds',
    diamond: '4',
    label: 'Turtle Club Diamond #4',
    aliases: ['turtle club diamond #4', 'diamond #4', 'diamond 4', 'tc 4']
  },
  {
    id: 'turtle-5',
    group: 'Turtle Club Diamonds',
    diamond: '5',
    label: 'Turtle Club Diamond #5',
    aliases: ['turtle club diamond #5', 'diamond #5', 'diamond 5', 'tc 5']
  },
  {
    id: 'turtle-6',
    group: 'Turtle Club Diamonds',
    diamond: '6',
    label: 'Turtle Club Diamond #6',
    aliases: ['turtle club diamond #6', 'diamond #6', 'diamond 6', 'tc 6']
  },
  {
    id: 'turtle-7',
    group: 'Turtle Club Diamonds',
    diamond: '7',
    label: 'Turtle Club Diamond #7',
    aliases: ['turtle club diamond #7', 'diamond #7', 'diamond 7', 'tc 7']
  },
  {
    id: 'villanova-1',
    group: 'Villanova Diamonds',
    diamond: '1',
    label: 'Villanova Diamond #1',
    aliases: ['villanova diamond #1', 'villanova 1', 'diamond #1', 'diamond 1']
  },
  {
    id: 'villanova-2',
    group: 'Villanova Diamonds',
    diamond: '2',
    label: 'Villanova Diamond #2',
    aliases: ['villanova diamond #2', 'villanova 2', 'diamond #2', 'diamond 2']
  },
  {
    id: 'vollmer-all',
    group: 'Vollmer and River Canard Diamonds',
    diamond: 'All Diamonds',
    label: 'Vollmer / River Canard',
    aliases: ['vollmer', 'river canard', 'vollmer and river canard', 'all diamonds']
  }
];

function normalizeStatusLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w]+/g, ' ')
    .trim();
}

function normalizeStatusChoice(value) {
  const normalized = normalizeStatusLookup(value);
  if (normalized.startsWith('open')) return 'Open';
  if (normalized.startsWith('closed') || normalized.startsWith('close')) return 'Closed';
  return String(value || '').trim();
}

function statusTargetById(id) {
  const normalized = String(id || '').trim().toLowerCase();
  return editableDiamondStatusTargets.find((target) => target.id === normalized) || null;
}

function statusTargetMatchesRow(target, row) {
  return Boolean(target && row)
    && String(target.group || '') === String(row.group || '')
    && String(target.diamond || '') === String(row.diamond || '');
}

function buildEditableStatusRows(rows = []) {
  return editableDiamondStatusTargets.map((target) => {
    const current = rows.find((row) => statusTargetMatchesRow(target, row)) || {};
    return {
      targetId: target.id,
      label: target.label,
      group: target.group,
      diamond: target.diamond,
      status: current.status || 'Unavailable',
      updatedAt: current.updatedAt || '',
      updatedBy: current.updatedBy || '',
      comments: current.comments || ''
    };
  });
}

module.exports = {
  editableDiamondStatusTargets,
  normalizeStatusChoice,
  normalizeStatusLookup,
  statusTargetById,
  statusTargetMatchesRow,
  buildEditableStatusRows
};
