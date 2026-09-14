import { Router, type IRouter } from "express";
import healthRouter from "./health";
import broadcasterRouter from "./broadcaster";
import radioRouter from "./radio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(broadcasterRouter);
router.use(radioRouter);

export default router;
