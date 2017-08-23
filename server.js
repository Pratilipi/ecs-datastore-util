const config = require( './config.js' )[ process.env.STAGE ];


const JsonArchive = require( './JsonArchive.js' ).init({
  gcsProjectId: config.STORAGE_PROJECT,
  gcsBucket: config.STORAGE_BUCKET
});

const BigqueryArchive = require( './BigqueryArchive.js' ).init({
  gcsProjectId: config.BIGQUERY_PROJECT,
  gcsBqDataset: config.BIGQUERY_DATASET
});

const jsonArchive = new JsonArchive();
const bigqueryArchive = new BigqueryArchive();


const archiveConfig = {
  USER:{
      kind:'USER', schema:require( `./schema/USER.js` ), fileName:'USER',
      sortBy:'_TIMESTAMP_', minValue:new Date(0),
      batchSize:1000, minUpdate: 100,
      timeInt:900, minTimeInt:300, maxTimeInt: 900, nextRun:0, boost: 10 },
  AUTHOR:{
      kind:'AUTHOR', schema:require( `./schema/AUTHOR.js` ), fileName:'AUTHOR',
      sortBy:'_TIMESTAMP_', minValue:new Date(0),
      batchSize:1000, minUpdate: 100,
      timeInt:5, minTimeInt:300, maxTimeInt: 900, nextRun:0, boost: 10 },
  PRATILIPI:{
      kind:'PRATILIPI', schema:require( `./schema/PRATILIPI.js` ), fileName:'PRATILIPI',
      sortBy:'_TIMESTAMP_', minValue:new Date(0),
      batchSize:1000, minUpdate: 100,
      timeInt:900, minTimeInt:300, maxTimeInt: 900, nextRun:0, boost: 10 },
  USER_AUTHOR:{
      kind:'USER_AUTHOR', schema:require( `./schema/USER_AUTHOR.js` ), fileName:'USER_AUTHOR',
      sortBy:'FOLLOW_DATE', minValue:new Date(0),
      batchSize:1000, minUpdate:1000,
      timeInt:900, minTimeInt:300, maxTimeInt:3600, nextRun:0, boost:100 },
  USER_PRATILIPI_201708:{
      kind:'USER_PRATILIPI', schema:require( `./schema/USER_PRATILIPI.js` ), fileName:'USER_PRATILIPI-2017.08',
      sortBy:'_TIMESTAMP_', minValue:new Date(1501525800000), maxValue:new Date(1504204200000),
      batchSize:1000, minUpdate:1000,
      timeInt:900, minTimeInt:300, maxTimeInt:3600, nextRun:0, boost:100 },
  USER_PRATILIPI_201709:{
      kind:'USER_PRATILIPI', schema:require( `./schema/USER_PRATILIPI.js` ), fileName:'USER_PRATILIPI-2017.09',
      sortBy:'_TIMESTAMP_', minValue:new Date(1504204200000), maxValue:new Date(1506796200000),
      batchSize:1000, minUpdate:1000,
      timeInt:900, minTimeInt:300, maxTimeInt:3600, nextRun:0, boost:100 },
  VOTE:{
      kind:'VOTE', schema:require( `./schema/VOTE.js` ), fileName:'VOTE',
      sortBy:'CREATION_DATE', minValue:new Date(0),
      batchSize:1000, minUpdate:1000,
      timeInt:900, minTimeInt:300, maxTimeInt:3600, nextRun:0, boost:100 },
  COMMENT:{
      kind:'COMMENT', schema:require( `./schema/COMMENT.js` ), fileName:'COMMENT',
      sortBy:'CREATION_DATE', minValue:new Date(0),
      batchSize:1000, minUpdate:1000,
      timeInt:900, minTimeInt:300, maxTimeInt:3600, nextRun:0, boost:100 }
};

const bigqueryConfig = {
  AUDIT_LOG: {
    kind:'AUDIT_LOG',
    schema:require( `./schema/AUDIT_LOG.js` ),
    sortBy:'CREATION_DATE',
    lastValue:null,
    batchSize:1000,
    minUpdate:100,
    timeInt:60,
    minTimeInt:60,
    maxTimeInt:900,
    nextRun:0
  }
};


(function run() {

  var archives = Object.keys( archiveConfig );
  for( var i = 0; i < archives.length; i++ ) {

    var archive = archives[ i ];
    var config = archiveConfig[ archive ];

    console.log(`RUN: before run ${archive}: ${config.nextRun} : ${config.timeInt}`);

    if( config.nextRun > new Date().getTime() ) {
      continue;
    }

    var callback = ( err, updateCount ) => {
      console.log(`RUN: after run in callback ${archive}: ${config.nextRun} : ${config.timeInt}`);
      if( err ) {
        console.error( archive + ": " + String( err ) );
      } else {
        if( updateCount === config.batchSize ) {
          config.timeInt = Math.max( config.minTimeInt, Math.ceil( config.timeInt / 2 ) );
        } else if( updateCount < config.minUpdate ) {
          config.timeInt = Math.min( config.maxTimeInt, config.timeInt * 2 );
        }
      }
      config.nextRun = new Date().getTime() + config.timeInt * 1000;
      console.log(`RUN: executing again.`);
      run();
    };

    console.log(`${archive}: Taking Backup`);
    return jsonArchive.run( archive, config, callback );

  }

  console.log(`RUN: All Backups Complete. Starting again after 5 seconds`);
  setTimeout( run, 5 * 1000 );

})();


( function bigQueryRun() {
  var bigQueries = Object.keys( bigqueryConfig );
  for( var i = 0; i < bigQueries.length; i++ ) {

    var bigQuery = bigQueries[ i ];
    var config = bigqueryConfig[ bigQuery ];

    console.log(`bigQueryRUN: before run ${bigQuery}: ${config.nextRun} : ${config.timeInt}`);

    if( config.nextRun > new Date().getTime() ) {
      continue;
    }

    var callback = ( err, updateCount ) => {
      console.log(`bigQueryRUN: after run in callback ${bigQuery}: ${config.nextRun} : ${config.timeInt}`);
      if( err ) {
        console.error( bigQuery + ": " + String( err ) );
      } else {
        if( ( updateCount + 1 ) === config.batchSize ) {
          config.timeInt = Math.max( config.minTimeInt, Math.ceil( config.timeInt / 2 ) );
        } else if( updateCount < config.minUpdate ) {
          config.timeInt = Math.min( config.maxTimeInt, config.timeInt * 2 );
        }
      }
      config.nextRun = new Date().getTime() + config.timeInt * 1000;
      console.log(`bigQueryRUN: executing again.`);
      bigQueryRun();
      };

    console.log(`${bigQuery}: Taking Backup`);
    return bigqueryArchive.run( bigQuery, config, callback );
  }

  console.log(`bigQueryRUN: All Backups Complete. Starting again after 5 seconds`);
  setTimeout( bigQueryRun, 5 * 1000 );
} )();
