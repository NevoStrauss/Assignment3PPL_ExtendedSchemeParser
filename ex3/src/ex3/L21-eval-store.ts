// L2-eval-box.ts
// L2 with mutation (set!) and env-box model
// Direct evaluation of letrec with mutation, define supports mutual recursion.

import {map} from "ramda";
import {
    Binding,
    CExp,
    DefineExp,
    Exp,
    IfExp,
    isAppExp,
    isBoolExp,
    isCExp,
    isDefineExp,
    isIfExp,
    isLetExp,
    isLitExp,
    isNumExp,
    isPrimOp,
    isProcExp,
    isSetExp,
    isStrExp,
    isVarRef,
    LetExp, makeNumExp,
    parseL21Exp,
    ProcExp,
    Program,
    SetExp,
    VarDecl
} from "./L21-ast";
import {
    applyEnv, applyStore,
    Env,
    extendStore,
    ExtEnv,
    globalEnvAddBinding, isInStore,
    makeExtEnv, setStore, Store,
    theGlobalEnv,
    theStore
} from "./L21-env-store";
import {Closure, isClosure, makeClosure, Value} from "./L21-value-store";
import {applyPrimitive} from "./evalPrimitive-store";
import {cons, first, isEmpty, rest} from "../shared/list";
import {bind, isOk, makeFailure, makeOk, mapResult, Result, safe2} from "../shared/result";
import {parse as p} from "../shared/parser";
import {makeBox, unbox} from "../shared/box";

// ========================================================
// Eval functions

const applicativeEval = (exp: CExp, env: Env): Result<Value> =>
    isNumExp(exp) ? makeOk(exp.val) :
        isBoolExp(exp) ? makeOk(exp.val) :
            isStrExp(exp) ? makeOk(exp.val) :
                isPrimOp(exp) ? makeOk(exp) :
                    isVarRef(exp) ? bind(applyEnv(env, exp.var),
                        (addr:number)=>applyStore(theStore,addr)) :
                        isLitExp(exp) ? makeOk(exp.val as Value) :
                            isIfExp(exp) ? evalIf(exp, env) :
                                isProcExp(exp) ? evalProc(exp, env) :
                                    isLetExp(exp) ? evalLet(exp, env) :
                                        isAppExp(exp) ? safe2((proc: Value, args: Value[]) =>{
                                                return applyProcedure(proc, args)})
                                            (applicativeEval(exp.rator, env), mapResult((rand: CExp) => applicativeEval(rand, env), exp.rands)) :
                                            isSetExp(exp) ? evalSet(exp, env) :
                                                exp;



export const isTrueValue = (x: Value): boolean =>
    ! (x === false);

const evalIf = (exp: IfExp, env: Env): Result<Value> =>
    bind(applicativeEval(exp.test, env),
        (test: Value) => isTrueValue(test) ? applicativeEval(exp.then, env) : applicativeEval(exp.alt, env));

const evalProc = (exp: ProcExp, env: Env): Result<Closure> =>
    makeOk(makeClosure(exp.args, exp.body, env));

// KEY: This procedure does NOT have an env parameter.
//      Instead we use the env of the closure.
const applyProcedure = (proc: Value, args: Value[]): Result<Value> =>
    isPrimOp(proc) ? applyPrimitive(proc, args) :
        isClosure(proc) ? applyClosure(proc, args) :
            makeFailure(`Bad procedure ${JSON.stringify(proc)}`);

const applyClosure = (proc: Closure, args: Value[]): Result<Value> => {
    const vars = map((v: VarDecl) => v.var, proc.params);
    const addresses = map((v:Value)=>{extendStore(theStore,v); return theStore.vals.length-1},args)
    const newEnv: ExtEnv = makeExtEnv(vars, addresses, proc.env)
    return evalSequence(proc.body, newEnv);
}

// Evaluate a sequence of expressions (in a program)
export const evalSequence = (seq: Exp[], env: Env): Result<Value> =>
    isEmpty(seq) ? makeFailure("Empty program") :
        evalCExps(first(seq), rest(seq), env);

const evalCExps = (first: Exp, rest: Exp[], env: Env): Result<Value> =>
    isDefineExp(first) ? evalDefineExps(first, rest) :
        isCExp(first) && isEmpty(rest) ? applicativeEval(first, env) :
            isCExp(first) ? bind(applicativeEval(first, env), _ => evalSequence(rest, env)) :
                first;

const evalDefineExps = (def: DefineExp, exps: Exp[]): Result<Value> =>
    bind(applicativeEval(def.val, theGlobalEnv),
        (v:Value):Result<Value> => {
            globalEnvAddBinding(def.var.var, extendStore(theStore, v).vals.length-1)
            return evalSequence(exps,theGlobalEnv)
        })

// Main program
// L2-BOX @@ Use GE instead of empty-env
export const evalProgram = (program: Program): Result<Value> =>
    evalSequence(program.exps, theGlobalEnv);

export const evalParse = (s: string): Result<Value> =>
    bind(bind(p(s), parseL21Exp), (exp: Exp) => evalSequence([exp], theGlobalEnv));

// LET: Direct evaluation rule without syntax expansion
// compute the values, extend the env, eval the body.
const evalLet = (exp: LetExp, env: Env): Result<Value> => {
    const vals = mapResult((v: CExp) => applicativeEval(v, env), map((b: Binding) => b.val, exp.bindings));
    const vars = map((b: Binding) => b.var.var, exp.bindings);


    return bind(vals, (vals: Value[]) => {
        const addresses = map((v:Value)=>{extendStore(theStore,v); return theStore.vals.length-1},vals)
        const newEnv = makeExtEnv(vars, addresses, env)
        return evalSequence(exp.body, newEnv);
    })
}

const evalSet = (exp:SetExp, env:Env): Result<void>=>
    safe2((addr:number, v:Value)=> makeOk(setStore(theStore, addr, v)))
    (applyEnv(env, exp.var.var) , applicativeEval(exp.val,env))

