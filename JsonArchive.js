const fs = require( 'fs' );
const readline = require( 'readline' );
const time = require( 'time' );
const AWS = require( 'aws-sdk' );


const storageClient = require( '@google-cloud/storage' );
const datastoreClient = require( './lib/DbUtility.js' );
var storage;
var s3 = new AWS.S3();
var bucket;
class JsonArchive {

  static init( config ) {
    storage = storageClient({ projectId: config.gcsProjectId }).bucket( config.gcsBucket );
    bucket = config.gcsBucket;
    return this;
  }


  run( archive, config, callback ) {

    this.archive = archive;
    this.config = config;
    this.callback = callback;
    this.datastore = datastoreClient({ projectId:process.env.GCP_PROJ_ID, kind:config.kind, schema:config.schema });
    this.boost = config.boost;

    if( fs.existsSync( this.config.fileName ) ) {

      console.log(`${this.archive}: File exists locally.`);
      this.readFromFile();

    } else {
      console.log(`${this.archive}: File doesn't exist locally. Checking storage`);

      var file = storage.file( this.config.fileName );

      file.exists( ( err, exists ) => {
        if( err ) {
          console.log( `${ this.archive }: Error while checking for file exist in storage.` );
          this.callback( err, null );
        } else if( exists ) {
          console.log(`${this.archive}: File exists in storage.`);
          console.log( `${ this.archive }: Downloading archive from GCS ...` );
          file.download( { destination:this.config.fileName }, ( err ) => {
            if( err ) {
              console.log( `${ this.archive }: Error while downloading for file in storage.` );
              this.callback( err, null );
            } else {
              console.log(`${this.archive}: File Downloaded from storage to local.`);
              this.readFromFile();
            }

          });
        } else {
          console.log(`${this.archive}: File doesn't exist in storage. Calling Datastore.`);
          this.updateFromDataStore( {} );
        }
      });

    }

  }


  readFromFile() {

    var entities = {};
    var minValue = '';

    console.log(`${this.archive}: Reading Local File.`);
    readline.createInterface({
      input: fs.createReadStream( this.config.fileName, { encoding: 'utf8' } )
    }).on( 'line', ( line ) => {
      var json = JSON.parse( line );
      entities[ json[ this.config.schema.primaryKey ] ] = json;
      if( minValue < json[ this.config.sortBy ] ) {
        minValue = json[ this.config.sortBy ];
      }
    }).on( 'close', () => {
      console.log( `${ this.archive }: ${ Object.keys( entities ).length } entities read from file system.` );
      this.config.minValue = new Date( minValue );
      this.updateFromDataStore( entities );
    });

  }


  updateFromDataStore( entities ) {

    console.log(`${this.archive}: Querying.`);
    var filter = [];
    filter.push([ this.config.sortBy, '>=', this.config.minValue ]);
    if( this.config.maxValue != null ) {
      filter.push([ this.config.sortBy, '<', this.config.maxValue ]);
    }
    var orderBy = [ this.config.sortBy ];

    this.datastore.query( filter, null, null, this.config.batchSize, orderBy ).then( ( updates ) => {
      console.log( `${ this.archive }: Found ${ updates.data.length } new additions/updations.` );
      if( updates.data.length <= 1 ) {
        this.callback( null, updates.data.length );
      } else {
        updates.data.forEach( ( json ) => {
          // HACK
          if( this.config.kind == 'PRATILIPI' ) {
            json.TAG_IDS = JSON.stringify( json.TAG_IDS );
            json.SUGGESTED_TAGS = JSON.stringify( json.SUGGESTED_TAGS );
          }
          if( this.config.minValue < json[ this.config.sortBy ] ) {
            this.config.minValue = json[ this.config.sortBy ];
          }
          entities[ json[ this.config.schema.primaryKey ] ] = json;
        });
        this.writeToFile( entities, updates.data.length );
      }
    }).catch( ( err ) => {
      console.error(`${ this.archive }: Error while querying on datastore.`);
      this.callback( err, null );
    });

  }


  writeToFile( entities, updateCount ) {

    console.log( `${ this.archive }: Writing to FS & GCS ...` );
    if( updateCount === this.config.batchSize && this.boost > 1 ) {
      this.boost--;
      console.log( `${ this.archive }: Boosting ... ${ this.boost }` );
      this.updateFromDataStore( entities );
      return;
    }

    if( this.config.boost > 1 ) {
      updateCount = updateCount + ( this.config.boost - this.boost ) * this.config.batchSize;
    }

    var wStream = fs.createWriteStream( this.config.fileName, { encoding: 'utf8' } );
    var gcsStream = storage.file( this.config.fileName ).createWriteStream();

    console.log( `${ this.archive }: Writing ${ Object.keys( entities ).length } entities with ${ updateCount } updates to FS & GCS ...` );

    Object.values( entities ).forEach( (json) => {
      var str = JSON.stringify( json );
      wStream.write( str + '\n' );
      gcsStream.write( str + '\n' );
    });
    wStream.on('error', (err) => {
      console.log(`${ this.archive }: Error local file write.`);
      this.callback( err, null );
    });
    gcsStream.on('error', (err) => {
      console.log(`${ this.archive }: Error storage file write.`);
      this.callback( err, null );
    });
    wStream.end();
    gcsStream.end();


    var date = new time.Date();
    date.setTimezone( 'Asia/Kolkata' );

    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var hour = date.getHours();
    var min = (date.getMinutes()/5 | 0) * 5;

    var timeStampStr = year +
        '-' + (month < 10 ? '0' + month : month) +
        '-' + (day < 10 ? '0' + day : day) +
        '-' + (hour < 10 ? '0' + hour : hour) +
        ':' + (min < 10 ? '0' + min : min);

    wStream.on('finish', () => {
      console.log(`${ this.archive }: All local file writes are now complete.`);
      if( this.archive === 'PRATILIPI' || this.archive === 'AUTHOR' ) {
        console.log( `${ this.archive }: Uploading to AWS S3 Bucket ${bucket}` );
        var pass = fs.createReadStream( this.config.fileName )
        var params = {
          Bucket: bucket,
          Key: this.config.fileName,
          Body: pass
        };
        var tempArchive = this.archive;
        s3.upload( params, function( err, data ) {
          if( err ) {
            console.error(`${ tempArchive }: Error while uploading to AWS S3.\n${ tempArchive }:  ${JSON.stringify(err)} `);
          } else {
            console.log( `${ tempArchive }: Uploaded to AWS S3.` );
          }
        });
      }
    });
    gcsStream.on('finish', () => {
      console.log(`${ this.archive }: All storage file writes are now complete.`);
      // Must wait for some time before making a copy as the object is not immediately available
      setTimeout( () => {
        var tempCallback = this.callback;
        var tempArchive = this.archive;
        console.log(`${tempArchive}: Copying file in storage.`);
        storage.file( this.config.fileName ).copy( this.config.fileName + '/' + timeStampStr, function(err, copiedFile, apiResponse) {
          if( err ) {
            console.error(`${tempArchive}: Error while copying file in storage.\n${tempArchive}: ${JSON.stringify(err)}`);
          } else {
            console.log(`${tempArchive}: Copied file in storage.`);
          }
          tempCallback( null, updateCount );
        });
      }, 60000 ); // 60 seconds

    });

  }

}


module.exports = JsonArchive;
