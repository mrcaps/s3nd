var sys = require("sys"),
    m = require("mongodb"),
    log = require("./public/js/log.js").getLogger(0);
    
//thanks https://github.com/gatesvp/cloudfoundry_node_mongodb/blob/master/app.js.2
if(process.env.VCAP_SERVICES){
    var env = JSON.parse(process.env.VCAP_SERVICES);
    exports.mongo = env["mongodb-1.8"][0]["credentials"];
}
else{
    exports.mongo = {"hostname":"127.0.0.1","port":27017,"username":"",
      "password":"","name":"","db":""};
}
var generate_mongo_url = function(obj){
    obj.hostname = (obj.hostname || "127.0.0.1");
    obj.port = (obj.port || 27017);
    obj.db = (obj.db || "s3nd");
  
    if(obj.username && obj.password){
      return "mongodb://" + obj.username + ":" + obj.password + "@" + obj.hostname + ":" + obj.port + "/" + obj.db;
    }
    else{
      return "mongodb://" + obj.hostname + ":" + obj.port + "/" + obj.db;
    }
}
var mongourl = exports.mongourl = generate_mongo_url(exports.mongo);

var VALIDCHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
var FIRSTVALID = VALIDCHARS[0] + VALIDCHARS[0] + VALIDCHARS[0];

var C_FILES = "files";
var C_META = "meta";

exports.ensureSetup = function() {
    m.connect(mongourl, function(err, conn) {
        console.log(mongourl, err);
        conn.collection(C_FILES, function(err, coll) {
            coll.createIndex({id: 1}, function() {
                log(0, "Done creating initial index.");
            });
        });
    });
}

/**
 * Connect to the DB
 * @param next continuation(connection)
 */
exports.connect = function(next) {
    m.connect(mongourl, function(err, conn) {
        next(conn);
    });
}

/**
 * Connect to a collection
 * @param name collection name
 * @param next continuation(error, collection)
 */
exports.getcoll = function(name, next) {
    m.connect(mongourl, function(err, conn) {
        if (err) {
            next(err, null);
        } else {
            conn.collection(name, function(err, coll) {
                if (err) {
                    next(err, null);
                } else {
                    next(null, coll);    
                }
            });
        }
    });
};

/**
 * @param conn connection
 * @param thecoll collection or collection name
 * @param k name of key to grab
 * @param v name of value to grab
 * @param next continuation(doc)
 */
exports.getsingle = function(conn, thecoll, k, v, next) {
    if ("string" === typeof thecoll) {
        return conn.collection(thecoll, function(err, coll) {
            exports.getsingle(conn, coll, k, v, next);
        });
    }
    
    var query = {};
    query[k] = v;
    thecoll.find(query, function(err, curs) {
        curs.toArray(function(err, items) {
            if (items.length > 1) {
                log(1, "Expected a " + k + " meta value query of length 1");
            }
            if (items.length == 0) {
                next(null);
            } else {
                next(items[0]);
            }
        });
    });
}

/**
 * @param conn connection
 * @parma thecoll collection or collection name
 * @param k name of key to match
 * @param v name of value to match
 * @param doc document to set
 * @param next continuation
 */
exports.setsingle = function(conn, thecoll, k, v, doc, next) {
    if ("string" === typeof thecoll) {
        return conn.collection(thecoll, function(err, coll) {
            exports.setsingle(conn, coll, k, v, doc, next);
        });
    }
    
    var query = {};
    query[k] = v;
    thecoll.update(query, doc, {upsert: true}, function(err) {
        next();
    });
}

/**
 * Get the last id in the
 * @param conn db connection
 * @param next continuation(lastid)
 */
exports.lastid = function(conn, next) {
    exports.getsingle(conn, C_META, "k", "lastid", function(it) {
        if (!it) {
            //initial value
            next(FIRSTVALID);
        } else {
            next(it.id);
        }
    });
}

exports.carry = function(id, pos) {
    if (id[pos] === VALIDCHARS[VALIDCHARS.length - 1]) {
        var uncarry = id.substring(0, pos) + VALIDCHARS[0] + id.substring(pos+1);
        //carry the position
        if (pos === 0) {
            //append to beginning
            return VALIDCHARS[0] + uncarry;
        } else {
            //carry over
            return exports.carry(uncarry, pos-1);
        }
    } else {
        //increment the position
        return id.substring(0, pos) +
            VALIDCHARS[VALIDCHARS.indexOf(id[pos])+1] +
            id.substring(pos+1);
    }
}

/**
 * @param conn db connection
 * @param next continuation(newid)
 */
exports.grabid = function(conn, next) {
    exports.lastid(conn, function(id) {
        id = exports.carry(id, id.length-1);
        
        conn.collection(C_FILES, function(err, coll) {
            //do we already have the id?
            // continuation(taken, id)
            var istaken = function(qid, next) {
                coll.find({id: qid}, function(err, curs) {
                    curs.toArray(function(err, items) {
                        if (items.length == 0) {
                            next(false, qid);
                        } else {
                            next(true, qid);
                        }
                    });
                });
            };
            
            var testset = function(qid) {
                istaken(qid, function(taken, retid) {
                    if (taken) {
                        log(0, "id " + qid + " was already taken.");
                        testset(exports.carry(qid, qid.length-1));
                    } else {
                        coll.insert({id: qid}, function(err) {
                            exports.setsingle(conn,
                                              C_META,
                                              "k",
                                              "lastid",
                                              {"$set":{id: qid}},
                                function() {
                                    next(qid);
                            });
                        });
                    }
                });
            };
            
            testset(id);
        });
    });
}

/**
 * @param conn connection
 * @param id the id to add a replica location to
 * @param loc replica location
 * @param next continuation
 */
exports.addreplica = function(conn, id, loc, next) {
    exports.setsingle(conn, C_FILES, "id", id,
        {"$push":{loc:loc}}, function() {
            next();
        });
}

exports.setfileprop = function(conn, id, k, v, next) {
    exports.setsingle(conn, C_FILES, "id", id,
        {"$set":{k:v}}, function() {
            next();
        })
}