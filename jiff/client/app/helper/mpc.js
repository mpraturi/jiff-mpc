if (typeof define !== 'function') {
  var define = require('amdefine')(module);
}

define(['constants'], function (constants) {

  const AVG = constants.AVG;
  const STD = constants.STD;
  const SELF = constants.SELF;
  const ALL = 'ALL';

  var setOrAssign = function (obj, keys, value) {
    for (var i = 0; i < keys.length - 1; i++) {
      var key = keys[i];
      if (obj[key] == null) {
        obj[key] = {};
      }

      obj = obj[key];
    }

    obj[keys[keys.length - 1]] = value;
  };

  var updateProgress = function (progressBar, percentage) {
    if (progressBar) {
      var percentageString = Math.floor(percentage * 100) + '%';
      progressBar.style.width = percentageString;
      progressBar.innerHTML = percentageString;
    }
  };

  // Order: consistent order on values as defined in the template.
  // The order will be the same on client, server, and analyst side.
  // Order:
  // 1. first tables data, then questions (if exist)
  // 2. tables come in the order they are defined in the template in.
  // 3. table is traversed by rows, then columns, in the order they are defined in the template in.
  // 4. questions come in the order they are defined in.
  // 5. for each question, the options come in the order they are defined in.
  // The returned object is formatted as follows:
  // {
  //   tables: [ { table: <first table name>, row: <first row key>, col: <first col key> }, ... ]
  //   questions: [ { question: <first question text>, option: <first option value> }, ... ]
  // }
  var consistentOrdering = function (table_template) {
    var tables = [];
    var questions = [];
    var usability = [];
    var table_meta = {};
    const cellwise_threshold = table_template.cellwise_threshold
    
    table_meta.cohort_group_by = table_template.cohort_group_by == null ? ALL : table_template.cohort_group_by;

    var table_rows_count, table_cols_count;
    // order tables
    for (let i = 0; i < table_template.tables.length; i++) {
      let table_def = table_template.tables[i];
      if (table_def.submit === false) {
        continue;
      }

      let rows = table_def.rows;
      let cols = table_def.cols[table_def.cols.length - 1];
      table_rows_count = rows.length;
      table_cols_count = cols.length;
      let totalLength = table_rows_count * table_cols_count;
      let cohortLength = totalLength;
      if (table_meta.cohort_group_by !== ALL) {
        cohortLength = table_meta.cohort_group_by.length * Math.floor(totalLength / table_cols_count);
      }
      table_meta[table_def.name] = {total: totalLength, cohort: cohortLength};
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
          let row = rows[r].key;
          let col = cols[c].key;
          tables.push({ table: table_def.name, row: row, col: col, op: table_def.operations, cohortOp: table_def.cohortOperations });
        }
      }
    }

    // put ratios in, if any
    if (table_template.ratios != null) {
      for (let ratio of table_template.ratios) {
        let table_def =  table_template.tables[ratio[0]];
        let table_name = table_template.tables[ratio[0]].name + ' : ' + table_template.tables[ratio[1]].name;

        let rows = table_def.rows;
        let cols = table_def.cols[table_def.cols.length - 1];
        let totalLength = table_rows_count * table_cols_count;
        let cohortLength = totalLength;
        if (table_meta.cohort_group_by !== ALL) {
          cohortLength = table_meta.cohort_group_by.length * Math.floor(totalLength / table_cols_count);
        }
        table_meta[table_name] = {total: totalLength, cohort: cohortLength};
        for (let r = 0; r < rows.length; r++) {
          for (let c = 0; c < cols.length; c++) {
            let row = rows[r].key;
            let col = cols[c].key;
            tables.push({ table: table_name, row: row, col: col, op: table_def.operations, cohortOp: table_def.cohortOperations });
          }
        }
      }
    }

    // order questions
    if (table_template.survey != null) {
      for (let q = 0; q < table_template.survey.questions.length; q++) {
        let question = table_template.survey.questions[q];
        for (let o = 0; o < question.inputs.length; o++) {
          let option = question.inputs[o].value;
          let label = question.inputs[o].label;
          questions.push({ question: question.question_text, option: option, label: label });
        }
      }
    }

    // order usability metrics
    if (table_template.usability != null) {
      for (let m = 0; m < table_template.usability.length; m++) {
        let metric = table_template.usability[m];

        if (typeof(metric) === 'string') {
          usability.push({metric: metric, field: ''});
        } else if (typeof(metric) === 'object') {
          let key = Object.keys(metric)[0];
          let arr = metric[key];
          for (let f = 0; f < arr.length; f++) {
            let field = arr[f];
            usability.push({metric: key, field: field});
          }
        }
      }
    }

    return { tables, questions, usability, table_rows_count, table_cols_count, table_meta, cellwise_threshold };
  };

  // Get all the shares that a party have shared
  var getShares = function (jiff_instance, partyID, ordering) {
    var result = {
      shares: [],
      squares: [],
      questions: [],
      usability: []
    };

    for (var k = 0; k < 2 * ordering.tables.length + ordering.questions.length + ordering.usability.length; k++) {
      var share =  jiff_instance.share(null, null, [1, 's1'], [partyID])[partyID];
      if (k < ordering.tables.length) {
        result.shares.push(share);
      } else if (k < 2 * ordering.tables.length) {
        result.squares.push(share);
      } else if (k < 2 * ordering.tables.length + ordering.questions.length) {
        result.questions.push(share);
      } else {
        result.usability.push(share);
      }
    }
    return result;
  };

  // Sum the given two arrays of secret shares placing the result in the first array
  var sumAndAccumulate = function (accumulator, shares) {
    if (accumulator == null || accumulator.length === 0) {
      return shares.slice();
    }

    for (var i = 0; i < accumulator.length; i++) {
      accumulator[i] = accumulator[i].sadd(shares[i]);
    }
    return accumulator;
  };

  // Sum the given two arrays of secret shares, placing the result in the first array
  // This is for cohorts: the accumulator is only grouped by gender and level, while the input
  // array has all groupings.
  var sumAndAccumulateCohort = function (accumulator, shares, ordering) {
    if (accumulator == null) {
      accumulator = [];
    }

    for (var i = 0; i < shares.length; i++) {
      var row = Math.floor(i / ordering.table_cols_count);
      var colMod3 = (i % ordering.table_cols_count) % 3; // 0 => female, 1 => male, 2 => non-binary
      var index = 3 * row + colMod3;
      if (accumulator[index]) {
        accumulator[index] = accumulator[index].sadd(shares[i]);
      } else {
        accumulator[index] = shares[i];
      }
    }

    return accumulator;
  };

  // Opens the shares corresponding to the logical slice results[rangeStart:rangeEnd) to the specified parties.
  // The slice is logical, no copies of arrays are created.
  // The returned result is a promise to an array of size (rangeEnd-rangeStart) containing
  // the opened results in order. Unless the caller is not specified as one of the result receiving parties
  // in which case the returned value is a promise to a bunch of nulls.
  // if rangeStart and/or rangeEnd is not provided, they default to 0 and length respectively.
  // Exceptions is a sorted array of positions to ignore, these positions are not opened, and instead
  // a value of '-' is returned for them. Exceptions defaults to [] if not provided.
  var openValues = function (jiff_instance, results, parties, rangeStart, rangeEnd) {
    if (rangeStart == null) {
      rangeStart = 0;
    }
    if (rangeEnd == null) {
      rangeEnd = results.length;
    }

    var promises = [];
    // var exceptionsIndex = 0; // keeps track of the next exception, fast way to check set membership since both set and values are sorted
    for (var i = rangeStart; i < rangeEnd; i++) {
      var promise = jiff_instance.open(results[i], parties);
      promises.push(promise);
    }

    return Promise.all(promises);
  };

  var openLimitedValues = function (jiff_instance, results, parties, idx_toignore, table_size, rangeStart, rangeEnd) {
    if (rangeStart == null) {
      rangeStart = 0;
    }
    if (rangeEnd == null) {
      rangeEnd = results.length;
    }

    var promises = [];
    for (var i = rangeStart; i < rangeEnd; i++) {       

      const idx = i%table_size; 
      if (i >= table_size && idx_toignore.has(idx)){
        promises.push(Promise.resolve(0));
      }
      else{
        // The value is opened only if the cell value meets the threshold 
        var promise = jiff_instance.open(results[i], parties);
        promises.push(promise);
      }
    }
    return Promise.all(promises);
  };

  var get_idx_toignore = async function (jiff_instance, results, parties, cellwise_threshold, rangeStart, rangeEnd, progressBar){
    if(!results){
      return
    }

    if (rangeStart == null||rangeStart < 0) {
      rangeStart = 0;
    }
    if (rangeEnd == null||rangeEnd > results.length) {
      rangeEnd = results.length;
    }

    var idx_toignore = new Set();

    for (var i = rangeStart; i < rangeEnd; i++) {
      var promise = await jiff_instance.open(results[i], parties);
      if (promise < cellwise_threshold) {
        idx_toignore.add(i);
      }
      if(progressBar){
        updateProgress(progressBar, 0.70 + (i/rangeEnd) * 0.1);
      }
    }

    return idx_toignore;
  }

  // Perform MPC computation for averages, deviations, questions, and usability
  var compute = async function (jiff_instance, submitters, ordering, progressBar) {
    updateProgress(progressBar, 0);

    // Compute these entities in order
    var sums, squaresSums, questions = null, usability = null;
    const cellwise_threshold = ordering.cellwise_threshold
    const table_size = ordering.table_cols_count*ordering.table_rows_count
    const cohort_size = ordering.table_rows_count*ordering.table_meta.cohort_group_by.length
    const cohort_output_size = ordering.table_rows_count*ordering.table_meta.cohort_group_by.length
    const data_size = ordering.tables.length

    // Temporary variables
    var cohort, i, p, shares;
    var promises = [];
    sums = {all: null}; // sums['all'] is for everyone, sums[<cohort>] is for <cohort> only
    squaresSums = {all: null};

    // Process shares from parties that do not belong to any cohort (their cohort has too few elements)
    var counter = 0;
    for (i = 0; i < submitters['none'].length; i++) {
      // Get all shares this party sent: values, squares of values, questions, and usability.
      shares = getShares(jiff_instance, submitters['none'][i], ordering);

      // Sum all things
      sums['all'] = sumAndAccumulate(sums['all'], shares.shares);
      squaresSums['all'] = sumAndAccumulate(squaresSums['all'], shares.squares);
      questions = sumAndAccumulate(questions, shares.questions);
      usability = sumAndAccumulate(usability, shares.usability);

      // garbage
      shares = null;
      await usability[usability.length - 1].promise;

      // progress
      counter++;
      updateProgress(progressBar, (counter / submitters['all'].length) * 0.60);
    }

    // Compute all the results: computation proceeds by party in order
    for (i = 0; i < submitters['cohorts'].length; i++) {
      cohort = submitters['cohorts'][i];

      for (p = 0; p < submitters[cohort].length; p++) {
        var partyID = submitters[cohort][p];

        // Get all shares this party sent: values, squares of values, questions, and usability.
        shares = getShares(jiff_instance, partyID, ordering);

        // Sum all things
        if (ordering.table_meta.cohort_group_by !== ALL) {
          sums[cohort] = sumAndAccumulateCohort(sums[cohort], shares.shares, ordering);
          squaresSums[cohort] = sumAndAccumulateCohort(squaresSums[cohort], shares.squares, ordering);
        } else {
          sums[cohort] = sumAndAccumulate(sums[cohort], shares.shares);
          squaresSums[cohort] = sumAndAccumulate(squaresSums[cohort], shares.squares);
        }
        sums['all'] = sumAndAccumulate(sums['all'], shares.shares);
        squaresSums['all'] = sumAndAccumulate(squaresSums['all'], shares.squares);
        questions = sumAndAccumulate(questions, shares.questions);
        usability = sumAndAccumulate(usability, shares.usability);

        // garbage
        shares = null;
        await usability[usability.length - 1].promise;

        // progress
        counter++;
        updateProgress(progressBar, (counter / submitters['all'].length) * 0.60);
      }

      // Cohort averages are done, open them (do not use await so that we do not block the main thread)
      var idx_toignore = await get_idx_toignore(jiff_instance, sums[cohort], [1, 's1'], cellwise_threshold, 0, cohort_size)
      
      // Open all sums and sums of squares
      var avgPromise = openLimitedValues(jiff_instance, sums[cohort], [1], idx_toignore, cohort_output_size);
      var squaresPromise = openLimitedValues(jiff_instance, squaresSums[cohort], [1], idx_toignore, cohort_output_size);
      promises.push(...[avgPromise, squaresPromise]);
    }

    // wait for cohort outputs
    var cohortOutputs = await Promise.all(promises);
    updateProgress(progressBar, 0.70);
    for (i = 0; i < submitters['cohorts'].length*2; i++) {
      // every 2 outputs belongs to same cohort - evens are sums; odds are square sums
      let idx = Math.floor(i / 2);
      if (i%2 === 0) {
        sums[submitters['cohorts'][idx]] = cohortOutputs[i];
      } else {
        squaresSums[submitters['cohorts'][idx]] = cohortOutputs[i];
      }
    }

    // Mask cell values below threshold
    /* Parties for get_idx_toignore must be [1, 's1'] because the server and 
       the browser must have access to the same idx_toignore to open shares in the same manner
       If [1] instead is given, then the server will open all shares and the browser opens only those with above threshold values,
       which leads to the discrepancy between two parties and the computation will stall at that point
    */
    var idx_toignore = await get_idx_toignore(jiff_instance, sums['all'], [1, 's1'], cellwise_threshold, 0, table_size, progressBar)
    updateProgress(progressBar, 0.95);
    
    // Open all sums and sums of squares if sum['all'] exists, i.e., the overall submission counts > threshold
    if(sums['all']){
      sums['all'] = await openLimitedValues(jiff_instance, sums['all'], [1], idx_toignore, table_size);
      squaresSums['all'] = await openLimitedValues(jiff_instance, squaresSums['all'], [1], idx_toignore, table_size);
      // Open questions and usability
      questions = await openValues(jiff_instance, questions, [1]);
      usability = await openValues(jiff_instance, usability, [1]);
    }
    else{
      const fillzeros=new Array(data_size).fill(0)
      sums['all'] = fillzeros
      squaresSums['all'] = fillzeros
      questions = []
      usability = fillzeros
    }

    updateProgress(progressBar, 1);

    // Put results in object
    return {
      sums: sums,
      squaresSums: squaresSums,
      questions: questions,
      usability: usability
    };
  };

  // Return format:
  // {
  //   averages: { <cohort number>: { table name: { table row: { table col: average } } }, ..., 'total': { same format but for all cohorts } }
  //   deviations: { 'all': { table_name: { table row: { table col: deviation ... } ... } ... } }  no cohort, object has results for all cohorts
  //   questions: { <cohort number>: { question text: { questions option: count } }, ..., 'total': { same format but for all cohorts } }
  //   usability: { metrics_object ...  no cohorts, the object is immediate for all cohorts }
  // }
  // Params:
  //    result: same result returned by compute()
  //    submitters: maps cohort ids (and 'all') to corresponding party ids
  //    ordering: result of consistentOrdering()
  var format = function (result, submitters, ordering) {
    var averages = {};
    var deviations = {};
    var questions = {};
    var usability = {};

    // Compute averages per cohort for respective genders
    var cols = ordering.table_cols_count;
    for (var c = 0; c < submitters['cohorts'].length; c++) {
      var cohort = submitters['cohorts'][c];

      for (var i = 0; i < result.sums[cohort].length; i++) {
        var rowIndex = ordering.table_meta.cohort_group_by === ALL ? Math.floor(i / ordering.table_cols_count) : Math.floor(i / ordering.table_meta.cohort_group_by.length);
        var table = ordering.tables[rowIndex * cols].table;
        var row = ordering.tables[rowIndex * cols].row;
        var col = ordering.tables[rowIndex * cols].col;
        if (ordering.table_meta.cohort_group_by !== ALL) {
          col = ordering.table_meta.cohort_group_by[i % ordering.table_meta.cohort_group_by.length]; // get right col label if grouping
        }
        var cohortOp = ordering.tables[rowIndex * cols].cohortOp;

        var cohortMean = result.sums[cohort][i];
        if (cohortOp[AVG] != null) {
          if (cohortOp[AVG] === SELF) {
            if(Number.isInteger(cohortMean)){
              cohortMean = cohortMean/submitters[cohort].length
            }
            else{
              cohortMean = cohortMean.div(submitters[cohort].length);
            }
            
          } else {
            let modVal = ordering.table_meta[cohortOp[AVG]].cohort;
            if(Number.isInteger(cohortMean)){
              cohortMean = cohortMean/result.sums[cohort][i % modVal]
            }
            else{
              cohortMean = cohortMean.div(result.sums[cohort][i % modVal]);
            }
          }
        }

        setOrAssign(averages, [cohort, table, row, col], cohortMean.toFixed(2));

        if (cohortOp[STD] != null) {
          // compute standard deviation among cohort
          // E[X^2]
          var avgOfSquares = result.squaresSums[cohort][i];
          if(Number.isInteger(avgOfSquares)){
            avgOfSquares = avgOfSquares/submitters[cohort].length
          }
          else{
            avgOfSquares = avgOfSquares.div(submitters[cohort].length);
          }
          // (E[X])^2
          if(Number.isInteger(result.sums[cohort][i])){
            var squareOfAvg = result.sums[cohort][i]/(submitters[cohort].length);
            squareOfAvg = squareOfAvg*squareOfAvg
          }
          else{
            var squareOfAvg = result.sums[cohort][i].div(submitters[cohort].length);
            squareOfAvg = squareOfAvg.pow(2);
          }
          // deviation formula: E[X^2] - (E[X])^2
          if(Number.isInteger(avgOfSquares)){
            var totalDeviation = avgOfSquares - squareOfAvg;
            totalDeviation = Math.sqrt(totalDeviation); //sqrt
          }
          else{
            var totalDeviation = avgOfSquares.minus(squareOfAvg);
            totalDeviation = totalDeviation.sqrt(); //sqrt
          }

          setOrAssign(deviations, [cohort, table, row, col], totalDeviation.toFixed(2));

        }
      }
    }

    // Compute averages and deviations for all parties
    for (i = 0; i < ordering.tables.length; i++) {
      table = ordering.tables[i].table;
      row = ordering.tables[i].row;
      col = ordering.tables[i].col;
      var op = ordering.tables[i].op;

      // Compute average
      var totalMean = result.sums['all'][i]; // mean for cell for ALL cohorts
      if (op[AVG] != null) {
        if (op[AVG] === SELF) { // if we're just averaging over the number of submitters
          if(Number.isInteger(totalMean)){

            /*
              If the overal submission count is less than the threshold defined a template, submitters gets 0 due to the getTrackerParties in server/jiff/tracker.js
              To avoid null value in divisions, assigning 0 to totalMean value 
            */ 

            if(submitters.all.length == 0){
              totalMean = 0
            }
            else{
              totalMean = totalMean/submitters.all.length
            }
          }
          else{
            totalMean = totalMean.div(submitters.all.length);
          }
        } else { // if we're averaging over values in a different table
          let modVal = ordering.table_meta[op[AVG]].total;
          if(Number.isInteger(totalMean)){

            /* 
              If the overal submission count is less than the threshold defined a template, submitters gets 0 due to the getTrackerParties in server/jiff/tracker.js
              To avoid null value in divisions, assigning 0 to totalMean value 
            */ 

            if(result.sums['all'][i % modVal] == 0){
              totalMean = 0
            }
            else{
              totalMean = totalMean/result.sums['all'][i % modVal]
            }
          }
          else{
            totalMean = totalMean.div(result.sums['all'][i % modVal]);
          }
        }
      }

      setOrAssign(averages, ['all', table, row, col], totalMean.toFixed(2));

      // Compute deviation for population of values presented by companies (not for individual employees)
      // E[X^2]
      avgOfSquares = result.squaresSums['all'][i];
      if(Number.isInteger(avgOfSquares)){

        /* 
          If the overal submission count is less than the threshold defined a template, submitters gets 0 due to the getTrackerParties in server/jiff/tracker.js
          To avoid null value in divisions, assigning 0 to totalMean value 
        */ 

        if(submitters['all'].length == 0){
          avgOfSquares = 0
        }
        else{
          avgOfSquares = avgOfSquares/submitters['all'].length;
        }
      }
      else{
        avgOfSquares = avgOfSquares.div(submitters['all'].length);
      }

      // (E[X])^2
      if(Number.isInteger(result.sums['all'][i])){

        /* 
          If the overal submission count is less than the threshold defined a template, submitters gets 0 due to the getTrackerParties in server/jiff/tracker.js
          To avoid null value in divisions, assigning 0 to totalMean value 
        */ 

        if(submitters['all'].length == 0){
          squareOfAvg = 0
        }
        else{
          squareOfAvg = result.sums['all'][i]/(submitters['all'].length);
          squareOfAvg = squareOfAvg*squareOfAvg
        }
      }
      else{
        squareOfAvg = result.sums['all'][i].div(submitters['all'].length);
        squareOfAvg = squareOfAvg.pow(2);
      }

      // deviation formula: E[X^2] - (E[X])^2
      if(Number.isInteger(avgOfSquares)){
        totalDeviation = avgOfSquares - squareOfAvg;
        totalDeviation = Math.sqrt(totalDeviation); //sqrt
      }
      else{
        totalDeviation = avgOfSquares.minus(squareOfAvg);
        totalDeviation = totalDeviation.sqrt(); //sqrt
      }

      setOrAssign(deviations, ['all', table, row, col], totalDeviation.toFixed(2));
    }

    // format questions as questions[<cohort>][<question>][<option>] = count of parties that choose this option
    for (i = 0; i < ordering.questions.length; i++) {
      var question = ordering.questions[i].question; // question title
      var label = ordering.questions[i].label; // option label/title

      var totalOptionCount = 0;
      for (var j = 0; j < submitters['cohorts'].length; j++) {
        cohort = submitters['cohorts'][j];

        // Format option count and sum it across cohorts
        var cohortOptionCount = result.questions[cohort][i];
        totalOptionCount = cohortOptionCount.add(totalOptionCount);

        setOrAssign(questions, [cohort, question, label], cohortOptionCount.toString());
      }

      setOrAssign(questions, ['all', question, label], totalOptionCount.toString());
    }

    // format usability as usability[<metric>][<field>] = value
    for (i = 0; i < ordering.usability.length; i++) {
      var metric = ordering.usability[i].metric;
      var field = ordering.usability[i].field;
      var value = result.usability[i];
      setOrAssign(usability, [metric, field], value.toString());
    }

    return {
      averages: averages,
      questions: questions,
      deviations: deviations,
      usability: usability,
      hasQuestions: ordering.questions.length > 0,
      hasUsability: ordering.usability.length > 0,
      cohorts: submitters,
    };
  };

  return {
    consistentOrdering: consistentOrdering,
    compute: compute,
    format: format
  }
});
