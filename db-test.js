var assert = require("assert"),
    log = require("./public/js/log.js").getLogger(0);
    db = require("./db.js");
    
exports.testTest = function(test) {
    test.equal("test", "test", "Test module functional");
    test.done();
}

exports.testLastID = function(test) {
    test.expect(1);
    
    assert.ok(true);
    
    db.connect(function(conn) {
        db.lastid(conn, function(id) {
            log(0, "Got last id " + id);
            
            test.ok(id.length > 0, "got nonempty id");
            
            test.done();
        });
    });
}

exports.testCarry = function(test) {
    test.equal("b", db.carry("a", 0));
    test.equal("c", db.carry("b", 0));
    test.equal("ab", db.carry("aa", 1));
    test.equal("ba", db.carry("aa", 0));
    test.equal("aa", db.carry("9", 0));
    test.equal("ba", db.carry("a9", 1));
    
    var st = "a";
    for (var i = 0; i < 100; ++i) {
        st = db.carry(st, st.length-1);
        //console.log(st);
    }
    
    test.done();
}

exports.testGrabId = function(test) {
    db.connect(function(conn) {
        db.grabid(conn, function(id) {
            log(0, "Grabbed new id " + id);
        });
    });
    
    test.done();
}