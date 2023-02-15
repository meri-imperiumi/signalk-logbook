function rad2deg(rad) {
  return Math.round((rad * 180) / Math.PI);
}

function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

module.exports = function stateToEntry(state, text, author = '') {
  const data = {
    datetime: state['navigation.datetime'] || new Date().toISOString(),
    text,
    author,
  };
  if (state['navigation.position']) {
    data.position = {
      ...state['navigation.position'],
    };
  }
  if (state['navigation.gnss.type'] && data.position) {
    data.position.source = state['navigation.gnss.type'];
  }
  if (!Number.isNaN(Number(state['navigation.headingTrue']))) {
    data.heading = rad2deg(state['navigation.headingTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.speedThroughWater']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.stw = ms2kt(state['navigation.speedThroughWater']);
  }
  if (!Number.isNaN(Number(state['navigation.speedOverGround']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.sog = ms2kt(state['navigation.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['navigation.trip.log']))) {
    data.log = parseFloat((state['navigation.trip.log'] / 1852).toFixed(1));
  }
  if (state['navigation.courseRhumbline.nextPoint.position']
    && !Number.isNaN(Number(state['navigation.courseRhumbline.nextPoint.position'].latitude))) {
    data.waypoint = state['navigation.courseRhumbline.nextPoint.position'];
  }
  if (!Number.isNaN(Number(state['environment.outside.pressure']))) {
    data.barometer = parseFloat((state['environment.outside.pressure'] / 100).toFixed(2));
  }
  if (!Number.isNaN(Number(state['environment.wind.speedOverGround']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.speed = ms2kt(state['environment.wind.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['environment.wind.directionTrue']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.direction = rad2deg(state['environment.wind.directionTrue']);
  }
  if (!Number.isNaN(Number(state['environment.water.swell.state']))) {
    data.sea = state['environment.water.swell.state'];
  }
  if (!Number.isNaN(Number(state['propulsion.main.runTime']))) {
    if (!data.engine) {
      data.engine = {};
    }
    data.engine.hours = parseFloat((state['propulsion.main.runTime'] / 60 / 60).toFixed(1));
  }
  return data;
};
