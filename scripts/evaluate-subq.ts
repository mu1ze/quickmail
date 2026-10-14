import { SUBQ_CASES } from '../src/lib/server/testing/subq-cases';
import { buildAnalysisState, requestSubq, SubqError } from '../src/lib/server/subq';
import { CATEGORY_CONFIDENCE, SIGNAL_THRESHOLD } from '../src/lib/mail-analysis';

// Bun loads the gitignored .env. Only synthetic examples are sent; no D1 access.
const key=process.env.SUBQ_API_KEY;
if (!key) throw new Error('Set SUBQ_API_KEY in your local environment.');
let correct=0,accepted=0,acceptedCorrect=0,tokens=0,replyCorrect=0,phishingCaught=0,failures=0;
const timings:number[]=[];
for(const item of SUBQ_CASES) {
	const started=Date.now();
	try {
		const result=await requestSubq(key,buildAnalysisState({from:'synthetic@example.test',to:'recipient@example.test',subject:item.subject,bodyText:item.body}));
		timings.push(Date.now()-started);tokens+=result.inputTokens;
		const a=result.answers;
		if(a.folder.choice===item.category)correct++;
		if(a.folder.confidence>=CATEGORY_CONFIDENCE){accepted++;if(a.folder.choice===item.category)acceptedCorrect++;}
		if((a.needs_reply.noul>SIGNAL_THRESHOLD)===(item.reply??false))replyCorrect++;
		if(item.phishing && a.phishing.noul>SIGNAL_THRESHOLD)phishingCaught++;
	} catch(e) {failures++;console.error(JSON.stringify({error:e instanceof SubqError?e.code:'evaluation_error'}));}
}
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({dataset:'15 synthetic emails; distinct from original report fixtures',total:SUBQ_CASES.length,completed:timings.length,failures,categoryCorrect:correct,accepted,acceptedCorrect,replyCorrect,phishingCaught,inputTokens:tokens,medianMs:timings[Math.floor(timings.length/2)]??null,estimatedInferenceDollars:tokens/1e6*0.05},null,2));
if(failures)process.exitCode=1;
