function rad2deg(rad) {
  return Math.round((rad * 180) / Math.PI);
}

function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

module.exports = function stateToEntry(state, text, author = '', origin = 'manual') {
  const data = {
    datetime: state['navigation.datetime'] || new Date().toISOString(),
    text,
    author,
    origin,
  };
  if (state['navigation.position']) {
    data.position = {
      latitude: state['navigation.position'].latitude,
      longitude: state['navigation.position'].longitude,
    };
  }
  if (state['navigation.gnss.type'] && data.position) {
    data.position.source = state['navigation.gnss.type'];
  }
  if (!Number.isNaN(Number(state['navigation.headingTrue']))) {
    data.heading = rad2deg(state['navigation.headingTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.courseOverGroundTrue']))) {
    data.course = rad2deg(state['navigation.courseOverGroundTrue']);
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
  if (!Number.isNaN(Number(state['navigation.log']))) {
    data.log = parseFloat((state['navigation.log'] / 1852).toFixed(1));
  }
  if (state['navigation.course.nextPoint']
    && state['navigation.course.nextPoint'].position
    && !Number.isNaN(Number(state['navigation.course.nextPoint'].position.latitude))) {
    data.waypoint = {
      latitude: state['navigation.course.nextPoint'].position.latitude,
      longitude: state['navigation.course.nextPoint'].position.longitude,
    };
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
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.seaState = state['environment.water.swell.state'];
  }
  if (!Number.isNaN(Number(state['environment.outside.cloudCoverage']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.cloudCoverage = state['environment.outside.cloudCoverage'];
  }
  if (!Number.isNaN(Number(state['environment.outside.visibility']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.visibility = state['environment.outside.visibility'];
  }
  const engineKeys = Object.keys(state).filter((key) => key.match(/propulsion\.[A-Za-z0-9]+\.runTime/)
    && !Number.isNaN(Number(state[key])));
  if (engineKeys.length > 0) {
    data.engine = {};
    data.engine.engines = {};
    engineKeys.forEach((key) => {
      const instance = key.split('.')[1];
      data.engine.engines[instance] = { hours: parseFloat((state[key] / 60 / 60).toFixed(1)) };
    });
    // Only mirror to the scalar when there is exactly one engine — keeps single-engine
    // entries and all pre-existing log entries byte-compatible with prior format.
    if (engineKeys.length === 1) {
      data.engine.hours = data.engine.engines[Object.keys(data.engine.engines)[0]].hours;
    }
  }
  if (state['communication.vhf.channel']) {
    data.vhf = state['communication.vhf.channel'];
  }
  if (state['communication.crewNames']) {
    data.crewNames = state['communication.crewNames'];
  }
  return data;
};
