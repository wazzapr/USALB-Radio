import { Router, type IRouter } from "express";
import healthRouter from "./health";
import broadcasterRouter from "./broadcaster";
import radioRouter from "./radio";
import listen2myradioRouter from "./listen2myradio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(broadcasterRouter);
router.use(radioRouter);
router.use(listen2myradioRouter);

export default router;
