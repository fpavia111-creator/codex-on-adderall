'use strict';
module.exports = {
  NAME: require('./name'),
  ...require('./config'), ...require('./budget'), ...require('./specgate'), ...require('./vet'),
  ...require('./safety'), ...require('./orchestrator'), ...require('./log'),
  license: require('./license'),
};
